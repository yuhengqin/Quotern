/** Server injects this inert JSON before the module script; normal clients have no marker. */
export interface DemoMetadata { schemaVersion: 1; readOnly: true; exportedAt: string; referenceTime: string }
export function getDemoMetadata(): DemoMetadata | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById('quotern-demo');
  if (!element) return null;
  try {
    const value = JSON.parse(element.textContent ?? '');
    if (value?.schemaVersion !== 1 || value.readOnly !== true || !Number.isFinite(Date.parse(value.exportedAt)) || !Number.isFinite(Date.parse(value.referenceTime))) throw new Error();
    return { schemaVersion: 1, readOnly: true, exportedAt: value.exportedAt, referenceTime: value.referenceTime };
  } catch { throw new Error('演示启动信息无效，请重新加载演示页面'); }
}
export const isDemoMode = () => getDemoMetadata() !== null;
export const dashboardNow = () => { const demo = getDemoMetadata(); return demo ? new Date(demo.referenceTime) : new Date(); };
export const demoStorageKey = (key: string) => { const demo = getDemoMetadata(); return demo ? `quotern-demo:${demo.exportedAt}:${key}` : key; };
