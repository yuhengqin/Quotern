import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent, EnvHttpProxyAgent, type Dispatcher } from 'undici';

const context = new AsyncLocalStorage<{ retryAfter: number | null }>();
const metadata = new WeakMap<object, number>();
let proxyAgent: EnvHttpProxyAgent | undefined;
let directAgent: Agent | undefined;

function quotaDispatcher(input: RequestInfo | URL): Dispatcher | undefined {
  if (!(process.env.http_proxy || process.env.HTTP_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY)) return;
  const hostname = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname;
  // Local readers carry process-specific credentials and must stay on loopback.
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname.startsWith('127.')) return directAgent ??= new Agent();
  // Reuse connections; closing here would race readers consuming response bodies.
  return proxyAgent ??= new EnvHttpProxyAgent();
}

export const quotaNodeFetch: typeof fetch = async (input, init) => {
  const dispatcher = quotaDispatcher(input);
  const response = await globalThis.fetch(input, dispatcher ? { ...init, dispatcher } as RequestInit : init);
  observeQuotaResponse(response);
  return response;
};
export async function captureQuotaRead<T>(read: () => Promise<T>): Promise<T> {
  const state = { retryAfter: null as number | null };
  const result = await context.run(state, read);
  if (state.retryAfter !== null && result && typeof result === 'object') metadata.set(result, state.retryAfter);
  return result;
}
export function observeQuotaResponse(response: Response): void {
  const state = context.getStore();
  if (!state || ![408, 429, 500, 502, 503, 504].includes(response.status)) return;
  const raw = response.headers.get('retry-after');
  if (!raw) return;
  const parsed = /^\d+$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  if (!Number.isFinite(parsed)) return;
  state.retryAfter = Math.max(state.retryAfter ?? 0, Math.max(1, Math.min(3600, parsed)));
}
export function quotaReadRetryAfter(value: unknown): number | null {
  return value && typeof value === 'object' ? metadata.get(value) ?? null : null;
}
