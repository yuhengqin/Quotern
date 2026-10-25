import { getDemoMetadata } from './demo-runtime.ts';

let cachedElement: Element | null = null;
let cached: { schemaVersion: number; exportedAt: string; referenceTime: string; responses: Record<string, { success: boolean; data: unknown }> } | null = null;

/** Exact request identities only. A document cannot donate responses to another snapshot. */
export function readDemoBootstrap<T>(input: string): T | undefined {
  const demo = getDemoMetadata();
  if (!demo) return undefined;
  const element = document.getElementById('quotern-demo-bootstrap');
  if (!element) return undefined;
  if (element !== cachedElement) {
    cachedElement = element;
    try { cached = JSON.parse(element.textContent ?? ''); } catch { cached = null; }
  }
  if (cached?.schemaVersion !== 1 || cached.exportedAt !== demo.exportedAt || cached.referenceTime !== demo.referenceTime || !cached.responses || typeof cached.responses !== 'object') return undefined;
  if (!Object.hasOwn(cached.responses, input)) return undefined;
  const response = cached.responses[input];
  if (response?.success !== true || response.data == null) return undefined;
  return JSON.parse(JSON.stringify(response.data)) as T;
}
