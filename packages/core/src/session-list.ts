import type { SessionActivity, SessionActivitySnapshot } from './session-observation.js';

export interface SessionListQuery {
  q?: string; filterSources?: string[]; project?: string; model?: string; group?: string;
  sort?: 'recent' | 'tokens' | 'cost' | 'duration'; direction?: 'ascending' | 'descending';
  page?: number; pageSize?: number;
}
export interface SessionListPage extends SessionActivitySnapshot {
  pagination: { page: number; pageSize: number; pages: number; totalRoots: number; totalSessions: number; from: number; to: number };
  facets: { sources: { value: string; count: number }[]; projects: { value: string; count: number }[]; models: string[] };
}
export interface SessionDetailResponse { session: SessionActivity | null; range: SessionActivitySnapshot['range'] }
export const sessionKey = (row: Pick<SessionActivity, 'source' | 'sessionId'>): string => JSON.stringify([row.source, row.sessionId]);
const modelNames = (row: SessionActivity) => row.modelNames ?? row.models?.map(model => model.model) ?? [row.model];

export function sessionTree(rows: readonly SessionActivity[]) {
  const byId = new Map(rows.map(row => [sessionKey(row), row]));
  const children = new Map<string, SessionActivity[]>(), roots: SessionActivity[] = [];
  for (const row of rows) {
    const relation = row.relation ?? row.insights;
    let cursor: SessionActivity | undefined = row;
    const visited = new Set<string>();
    let cycle = false;
    while (cursor && (cursor.relation ?? cursor.insights)?.parentId) {
      const id = sessionKey(cursor);
      if (visited.has(id)) { cycle = true; break; }
      visited.add(id);
      cursor = byId.get(sessionKey({ source: cursor.source, sessionId: (cursor.relation ?? cursor.insights)!.parentId! }));
    }
    const parent = relation?.parentId ? sessionKey({ source: row.source, sessionId: relation.parentId }) : null;
    if (parent && !cycle && !relation?.relationConflict && byId.has(parent)) {
      const group = children.get(parent) ?? []; group.push(row); children.set(parent, group);
    } else roots.push(row);
  }
  return { roots, children };
}

export function selectSessionList(snapshot: SessionActivitySnapshot, query: SessionListQuery) {
  const attribution = query.group ? snapshot.billing.find(row => JSON.stringify([row.service, row.mode, row.accountRef]) === query.group) : undefined;
  const refs = new Set(attribution?.sessionRefs?.map(sessionKey));
  const rows = query.group ? snapshot.sessions.filter(row => refs.has(sessionKey(row))) : snapshot.sessions;
  const needle = query.q?.trim().toLocaleLowerCase();
  const matches = (row: SessionActivity, ignore?: 'source' | 'project') =>
    (ignore === 'source' || !query.filterSources?.length || query.filterSources.includes(row.source)) &&
    (ignore === 'project' || !query.project || row.projectLabel === query.project) &&
    (!query.model || row.model === query.model || modelNames(row).includes(query.model)) &&
    (!needle || [row.sessionTitle, row.relation?.agentNickname ?? row.insights?.agentNickname, row.relation?.agentRole ?? row.insights?.agentRole, row.projectLabel, row.source, row.sessionId, row.model, ...modelNames(row)].some(value => value?.toLocaleLowerCase().includes(needle)));
  const options = (key: 'source' | 'projectLabel', selected: readonly string[], ignore: 'source' | 'project') => {
    const counts = new Map<string, number>();
    for (const row of rows) if (matches(row, ignore)) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
    for (const value of selected) if (value && !counts.has(value)) counts.set(value, 0);
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
  };
  const models = [...new Set(rows.flatMap(modelNames))].filter(model => model !== 'unknown').sort();
  if (query.model && !models.includes(query.model)) models.push(query.model);
  const order = query.direction === 'ascending' ? 1 : -1;
  const selected = rows.filter(row => matches(row)).sort((a, b) => {
    let compared: number;
    if (!query.sort || query.sort === 'recent') compared = order * a.lastActivityAt.localeCompare(b.lastActivityAt);
    else {
      const field = query.sort === 'cost' ? 'costUsd' : query.sort === 'duration' ? 'taskSeconds' : 'tokens';
      const first = a[field], second = b[field];
      compared = first == null || second == null ? Number(first == null) - Number(second == null) : order * (first - second);
    }
    return compared || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.source.localeCompare(b.source) || a.sessionId.localeCompare(b.sessionId);
  });
  return { selected, facets: { sources: options('source', query.filterSources ?? [], 'source'), projects: options('projectLabel', query.project ? [query.project] : [], 'project'), models } };
}

export function pageSessionList(snapshot: SessionActivitySnapshot, query: SessionListQuery): SessionListPage {
  const { selected, facets } = selectSessionList(snapshot, query);
  const { roots, children } = sessionTree(selected);
  const pageSize = query.pageSize ?? 12, pages = Math.max(1, Math.ceil(roots.length / pageSize));
  const page = Math.min(pages, Math.max(1, query.page ?? 1));
  const first = (page - 1) * pageSize;
  const sessions: SessionActivity[] = [], pending = [...roots.slice(first, first + pageSize)];
  for (let index = 0; index < pending.length; index++) {
    const row = pending[index]!; sessions.push(row); pending.push(...children.get(sessionKey(row)) ?? []);
  }
  return { ...snapshot, sessions, sessionCount: selected.length, facets,
    billing: snapshot.billing.map(({ sessionRefs, ...row }) => ({ ...row, sessionCount: sessionRefs?.length ?? row.sessionCount ?? 0 })),
    pagination: { page, pageSize, pages, totalRoots: roots.length, totalSessions: selected.length, from: roots.length ? first + 1 : 0, to: Math.min(first + pageSize, roots.length) } };
}
