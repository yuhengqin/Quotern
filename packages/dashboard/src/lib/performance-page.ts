import type { PerformanceGroup, PerformanceReport } from 'quotern-core';

export type PerformanceSort = 'label' | 'ttftP50Ms' | 'ttftP95Ms' | 'tokensPerSecond';
export interface PerformanceSearch { days: number; source: string; model: string; project: string; groupBy: PerformanceGroup; sort: PerformanceSort; direction: 'ascending' | 'descending'; compare: string[] }
export function parsePerformanceSearch(raw: Record<string, unknown>): PerformanceSearch {
  const text = (key: string) => typeof raw[key] === 'string' ? (raw[key] as string).slice(0, 1024) : '';
  return { days: [1, 7, 30, 90].includes(Number(raw.days)) ? Number(raw.days) : 7,
    source: text('source'), model: text('model'), project: text('project'),
    groupBy: ['source', 'model', 'project'].includes(String(raw.groupBy)) ? raw.groupBy as PerformanceGroup : 'model',
    sort: ['label', 'ttftP50Ms', 'ttftP95Ms', 'tokensPerSecond'].includes(String(raw.sort)) ? raw.sort as PerformanceSort : 'label',
    direction: raw.direction === 'descending' ? 'descending' : 'ascending',
    compare: Array.isArray(raw.compare) ? [...new Set(raw.compare.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024))].slice(0, 4) : [] };
}

export function sortPerformanceGroups(rows: PerformanceReport['groups'], sort: PerformanceSort, direction: PerformanceSearch['direction']) {
  return [...rows].sort((a, b) => {
    const first = a[sort], second = b[sort];
    if (first === null || second === null) return first === second ? a.label.localeCompare(b.label) : first === null ? 1 : -1;
    const order = typeof first === 'string' ? first.localeCompare(String(second)) : first - Number(second);
    return (direction === 'descending' ? -order : order) || a.label.localeCompare(b.label);
  });
}

/** Old runtimes reject unknown query parameters; retain their usable base report. */
export async function loadPerformanceReport(query: string, load: (url: string) => Promise<PerformanceReport>): Promise<PerformanceReport & { comparisonUnsupported?: boolean }> {
  try { return await load(query); }
  catch (error) {
    const [path, search] = query.split('?'), params = new URLSearchParams(search);
    if (!params.has('compareModels') || !(error instanceof Error) || error.message !== 'INVALID_PERFORMANCE_QUERY') throw error;
    params.delete('compareModels');
    return { ...await load(`${path}?${params}`), comparisonUnsupported: true };
  }
}
