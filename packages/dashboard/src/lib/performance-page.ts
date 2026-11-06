import type { PerformanceGroup } from 'quotern-core';

export interface PerformanceSearch { days: number; source: string; model: string; project: string; groupBy: PerformanceGroup }
export function parsePerformanceSearch(raw: Record<string, unknown>): PerformanceSearch {
  const text = (key: string) => typeof raw[key] === 'string' ? (raw[key] as string).slice(0, 1024) : '';
  return { days: [1, 7, 30, 90].includes(Number(raw.days)) ? Number(raw.days) : 7,
    source: text('source'), model: text('model'), project: text('project'),
    groupBy: ['source', 'model', 'project'].includes(String(raw.groupBy)) ? raw.groupBy as PerformanceGroup : 'model' };
}
