import type { QuotaServiceStatus } from './quota.js';

type Level = QuotaServiceStatus['level'];
const levels: Record<string, Level> = { none: 'operational', minor: 'minor', major: 'major', critical: 'critical', maintenance: 'maintenance' };
const componentLevels: Record<string, Level> = { operational: 'operational', degraded_performance: 'minor', partial_outage: 'major', major_outage: 'critical', under_maintenance: 'maintenance' };
const rank: Record<Level, number> = { operational: 0, unknown: 1, maintenance: 2, minor: 3, major: 4, critical: 5 };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit = 300) => typeof value === 'string' ? value.slice(0, limit) : '';
const rows = (value: unknown) => Array.isArray(value) ? value.slice(0, 200).map(object) : [];
const timestamp = (value: unknown) => { const at = typeof value === 'string' ? Date.parse(value) / 1000 : NaN; return Number.isFinite(at) ? at : null; };

export function parseQuotaServiceStatus(value: unknown): Level {
  const indicator = object(object(value).status).indicator;
  if (typeof indicator !== 'string' || !Object.hasOwn(levels, indicator)) throw new Error('Unknown service status');
  return levels[indicator];
}

/** Project the public Statuspage summary; never forward arbitrary URLs or raw HTML. */
export function parseQuotaServiceSummary(value: unknown, url: string, checkedAt: number): QuotaServiceStatus {
  const raw = object(value);
  return { level: parseQuotaServiceStatus(raw), url, checkedAt, stale: false,
    components: rows(raw.components).filter(row => typeof row.id === 'string' && typeof row.name === 'string').map(row => ({
      id: text(row.id), name: text(row.name), level: Object.hasOwn(componentLevels, text(row.status)) ? componentLevels[text(row.status)] : 'unknown',
    })),
    incidents: rows(raw.incidents).filter(row => /^[a-zA-Z0-9_-]+$/.test(text(row.id)) && !['resolved', 'postmortem'].includes(text(row.status))).map(row => {
      const update = rows(row.incident_updates).sort((a, b) => (timestamp(b.created_at) ?? 0) - (timestamp(a.created_at) ?? 0))[0] ?? {};
      return { id: text(row.id), name: text(row.name), phase: text(update.status || row.status),
        level: Object.hasOwn(levels, text(row.impact)) ? levels[text(row.impact)] : 'unknown', componentIds: rows(row.components).map(component => text(component.id)).filter(Boolean),
        body: text(update.body, 4000), updatedAt: timestamp(update.created_at) ?? timestamp(row.updated_at), url: new URL(`incidents/${text(row.id)}`, url).toString() };
    }),
  };
}

export function selectQuotaServiceStatus(status: QuotaServiceStatus, selected?: readonly string[]): QuotaServiceStatus {
  if (selected === undefined) {
    const level = (status.components ?? []).reduce<Level>((worst, component) => rank[component.level] > rank[worst] ? component.level : worst, status.level);
    return { ...status, level };
  }
  if (!selected.length) return { ...status, level: 'unknown', incidents: [], selectionEmpty: true };
  const components = status.components?.filter(component => selected.includes(component.id)) ?? [];
  const incidents = status.incidents?.filter(incident => !incident.componentIds.length || incident.componentIds.some(id => selected.includes(id))) ?? [];
  const known = components.length === selected.length;
  const candidates = [...components, ...incidents].map(item => item.level);
  const level = candidates.reduce<Level>((worst, next) => rank[next] > rank[worst] ? next : worst, known ? 'operational' : 'unknown');
  return { ...status, level, incidents, selectionEmpty: false };
}
