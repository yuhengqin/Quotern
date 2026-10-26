import type { QuotaReport } from './report.js';
/** Bounded plain text for a prompt: no runtime, credentials, network or filesystem operations. */
export function formatQuotaPrompt(report: QuotaReport): string {
  if (report.availability !== 'ready') return 'Quotern quota unknown';
  const lines = report.providers.filter(p => !p.id.includes('@') || p.canonicalId === p.id).slice(0, 3).map(p => {
    if (report.stale || p.stale) return `${p.label} stale`;
    if (p.status !== 'ready') return `${p.label} unknown`;
    const w = p.windows.find(w => !w.stale && w.kind === 'percentage');
    if (!w || w.usedPercent === null) return `${p.label} ${p.windows.some(w => w.stale) ? 'stale' : 'unknown'}`;
    const name = w.periodSeconds === 18000 ? '5h' : w.periodSeconds === 604800 ? '7d' : w.id.slice(0, 32);
    const age = p.fetchedAt === null ? '?' : String(Math.max(0, Math.floor((report.readAt - p.fetchedAt) / 60)));
    return `${p.label} ${name} ${Math.floor(100 - w.usedPercent)}% (${age}m)`;
  });
  return (lines.join(' | ') || 'Quotern quota unknown').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512);
}
