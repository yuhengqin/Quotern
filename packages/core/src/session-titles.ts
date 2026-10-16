import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { codexHomeCandidates, opencodeDbPath } from './paths.js';
import { codexLedgerDbPaths, newestCodexLedgerPaths } from './parsers/codex-ledger.js';
import { queryDbJson } from './parsers/sqlite.js';
import type { SessionActivity } from './session-observation.js';

export interface SessionTitle { title: string; priority: number }
export const sessionTitleKey = (source: string, sessionId: string) => JSON.stringify([source, sessionId]);

/** Only named metadata enters this module; never derive a title from message content. */
export function cleanSessionTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined;
}

export function extractSessionTitle(source: string, record: Record<string, unknown>, fallbackId: string): { sessionId: string; value: SessionTitle } | null {
  if (source !== 'claude' || !['custom-title', 'ai-title'].includes(String(record.type))) return null;
  const custom = record.type === 'custom-title';
  const title = cleanSessionTitle(custom ? record.customTitle : record.aiTitle);
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : fallbackId;
  return title && sessionId ? { sessionId, value: { title, priority: custom ? 2 : 1 } } : null;
}

const indexCache = new Map<string, { stamp: string; titles: Map<string, string> }>();
export async function readCodexSessionIndex(path: string): Promise<Map<string, string>> {
  try {
    const st = await stat(path);
    if (st.size > 32 * 1024 * 1024) return new Map();
    const stamp = `${st.mtimeMs}:${st.size}`, cached = indexCache.get(path);
    if (cached?.stamp === stamp) return cached.titles;
    const titles = new Map<string, string>();
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      try {
        const row = JSON.parse(line), title = cleanSessionTitle(row.thread_name);
        if (typeof row.id === 'string' && title) titles.set(row.id, title);
      } catch { /* Ignore an incomplete append without losing previous names. */ }
    }
    indexCache.set(path, { stamp, titles });
    return titles;
  } catch { return new Map(); }
}

export function readSessionTitleDatabase(path: string, source: 'codex' | 'opencode'): Map<string, string> {
  try {
    const table = source === 'codex' ? 'threads' : 'session', column = source === 'codex' ? 'name' : 'title';
    const options = { readOnly: true, timeout: 2000, maxBuffer: 32 * 1024 * 1024 };
    const columns = new Set(queryDbJson(path, `SELECT name FROM pragma_table_info('${table}')`, options).map(row => row.name));
    if (!columns.has('id') || !columns.has(column)) return new Map();
    // Codex's title/first_user_message columns may contain raw prompts. Read only name.
    const rows = queryDbJson(path, `SELECT id, ${column} AS session_name FROM ${table}`, options);
    return new Map(rows.flatMap(row => {
      const title = cleanSessionTitle(row.session_name);
      return typeof row.id === 'string' && title ? [[row.id, title] as const] : [];
    }));
  } catch { return new Map(); }
}

export async function attachSessionTitles(sessions: SessionActivity[], stored: Map<string, SessionTitle>): Promise<void> {
  const titles = new Map([...stored].map(([key, value]) => [key, value.title]));
  if (sessions.some(row => row.source === 'codex')) {
    for (const path of newestCodexLedgerPaths(codexLedgerDbPaths())) {
      for (const [id, title] of readSessionTitleDatabase(path, 'codex')) titles.set(sessionTitleKey('codex', id), title);
    }
    for (const home of codexHomeCandidates()) {
      for (const [id, title] of await readCodexSessionIndex(join(home, 'session_index.jsonl'))) titles.set(sessionTitleKey('codex', id), title);
    }
  }
  if (sessions.some(row => row.source === 'opencode')) {
    for (const [id, title] of readSessionTitleDatabase(opencodeDbPath(), 'opencode')) titles.set(sessionTitleKey('opencode', id), title);
  }
  for (const row of sessions) {
    const title = titles.get(sessionTitleKey(row.source, row.sessionId));
    if (title) row.sessionTitle = title;
  }
}
