import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent, EnvHttpProxyAgent, type Dispatcher } from 'undici';
import type { QuotaDiagnosticAttempt, QuotaDiagnosticCode } from '../shared/quota-diagnostic.js';

interface Capture { retryAfter: number | null; attempts: QuotaDiagnosticAttempt[]; responses: WeakSet<Response> }
const context = new AsyncLocalStorage<Capture>();
const metadata = new WeakMap<object, Capture>();
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
  try {
    const response = await globalThis.fetch(input, dispatcher ? { ...init, dispatcher } as RequestInit : init);
    observeQuotaResponse(response);
    return response;
  } catch (error) { observeQuotaError(error); throw error; }
};
export async function captureQuotaRead<T>(read: () => Promise<T>): Promise<T> {
  const state = context.getStore() ?? { retryAfter: null, attempts: [], responses: new WeakSet<Response>() };
  const result = await context.run(state, read);
  if (result && typeof result === 'object') metadata.set(result, state);
  return result;
}
export function recordQuotaAttempt(attempt: QuotaDiagnosticAttempt): void {
  const state = context.getStore();
  if (state && state.attempts.length < 24) state.attempts.push(attempt);
}
export function observeQuotaError(error: unknown): void {
  const name = (error as { name?: unknown } | null)?.name;
  recordQuotaAttempt({ stage: name === 'SyntaxError' ? 'parse' : 'http', outcome: 'failure',
    code: name === 'SyntaxError' ? 'INVALID_RESPONSE' : name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' });
}
export function observeQuotaResponse(response: Response): void {
  const state = context.getStore();
  if (!state || state.responses.has(response)) return;
  state.responses.add(response);
  const code: QuotaDiagnosticCode | null = response.ok ? null : response.status === 401 ? 'AUTH_EXPIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
  recordQuotaAttempt({ stage: 'http', outcome: response.ok ? 'success' : 'failure', code, httpStatus: response.status });
  if (![408, 429, 500, 502, 503, 504].includes(response.status)) return;
  const raw = response.headers.get('retry-after');
  if (!raw) return;
  const parsed = /^\d+$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  if (!Number.isFinite(parsed)) return;
  state.retryAfter = Math.max(state.retryAfter ?? 0, Math.max(1, Math.min(3600, parsed)));
}
export function quotaReadRetryAfter(value: unknown): number | null {
  return value && typeof value === 'object' ? metadata.get(value)?.retryAfter ?? null : null;
}
export function quotaReadAttempts(value: unknown): QuotaDiagnosticAttempt[] {
  return value && typeof value === 'object' ? structuredClone(metadata.get(value)?.attempts ?? []) : [];
}
