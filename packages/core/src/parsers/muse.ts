import { readdirSync, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { createJsonlLineReader } from './jsonl-tail.js';
import { accumulateBucket, bucketsFromState, type BucketAccumulator } from './shared.js';
import { resolveProjectName } from '../project-name.js';
import { bucketKey, toUtcHalfHourStart } from '../queue/keys.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export interface MuseUsage { id: string; timestamp: string; model: string; tokens: TokenTotals }
export interface MuseFileState { fingerprint: string; project: string; events: MuseUsage[] }
export interface MuseCursorState { since: string; files: Record<string, MuseFileState>; buckets: QueueBucket[] }
/** Both projections choose the first record in the lexically first persisted file. */
export function orderedMuseFiles<T>(files: Record<string, T>): T[] {
  return Object.keys(files).sort().map(path => files[path]!);
}
export function museSessionsDir(): string {
  return process.env.MUSE_SESSIONS_DIR?.trim() || join(process.env.MUSE_DATA_DIR?.trim() || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'muse'), 'sessions');
}
export function findMuseSessionFiles(root = museSessionsDir()): { filePath: string; sessionId: string }[] {
  const paths: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (depth > 5 || !existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name), depth + 1);
      else if (entry.isFile() && entry.name === 'session.jsonl') paths.push(join(directory, entry.name));
    }
  };
  walk(root, 0);
  return paths.sort().map(filePath => ({ filePath, sessionId: basename(dirname(filePath)) }));
}
/** Retained frames contain one level of serialized records. Never recurse into arbitrary payloads. */
export function museRecords(value: unknown): Obj[] {
  const record = object(value), records = [record];
  if (Array.isArray(record.children)) for (const child of record.children) {
    const serialized = object(child).record_json;
    if (typeof serialized !== 'string') continue;
    try { records.push(object(JSON.parse(serialized))); } catch { /* Incomplete frame. */ }
  }
  return records;
}
export function museProject(record: Obj): { path: string; primary: boolean } | null {
  const data = object(object(record.payload).record);
  const primary = record.payload_type === 'runtime.session.metadata';
  const value = primary ? data.workspace_root : record.payload_type === 'runtime.session.route_facts' ? data.cwd : null;
  return typeof value === 'string' && value.trim() ? { path: value, primary } : null;
}
export function decodeMuseUsage(record: Obj): MuseUsage | null {
  const payload = object(record.payload), event = object(payload.event), usage = object(event.usage);
  const review = payload.kind === 'approval' && event.kind === 'automated_review_completed';
  if (record.payload_type !== 'runtime.session' || !(review || payload.kind === 'run' && event.kind === 'model_completed')) return null;
  const model = review && typeof event.model === 'object' ? object(event.model).model_id : event.model;
  const input = usage.input_tokens, output = usage.output_tokens;
  const read = usage.cache_read_tokens ?? usage.cached_input_tokens ?? usage.cached_tokens ?? 0, write = usage.cache_write_tokens ?? 0;
  if (typeof record.id !== 'string' || !record.id || typeof model !== 'string' || !model.trim()
    || !count(record.recorded_at) || !count(input) || !count(output) || !count(read) || !count(write) || read + write > input || !Number.isSafeInteger(input + output)) return null;
  const time = record.recorded_at / 1000;
  if (time > 8.64e15) return null;
  return { id: createHash('sha256').update(record.id).digest('hex'), timestamp: new Date(time).toISOString(), model: model.trim().slice(0, 256),
    tokens: { input_tokens: input - read - write, output_tokens: output, cached_input_tokens: read, cache_creation_input_tokens: write,
      reasoning_output_tokens: 0, total_tokens: input + output, conversation_count: 1 } };
}
const fields = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'reasoning_output_tokens', 'total_tokens', 'conversation_count'] as const;
/** Cache numerical projections per file; re-read changed files to handle journal rewrites and late metadata. */
export async function parseMuseIncremental(cursors: CursorsFile, statsSince: string, root = museSessionsDir()) {
  const previous = cursors.muse;
  const files = { ...(previous?.files ?? {}) }, since = Date.parse(statsSince);
  let filesProcessed = 0, eventsParsed = 0;
  for (const { filePath } of findMuseSessionFiles(root)) {
    const info = await stat(filePath);
    const fingerprint = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (previous?.since === statsSince && files[filePath]?.fingerprint === fingerprint) continue;
    const events: MuseUsage[] = [];
    let workspace = '', fallback = '';
    const reader = createJsonlLineReader(filePath, 0);
    for await (const line of reader) {
      let value: unknown;
      try { value = JSON.parse(line); } catch { continue; }
      for (const record of museRecords(value)) {
        const location = museProject(record);
        if (location) { if (location.primary) workspace = location.path; else fallback = location.path; }
        const event = decodeMuseUsage(record);
        if (event && Date.parse(event.timestamp) >= since) events.push(event);
      }
    }
    files[filePath] = { fingerprint, project: resolveProjectName(workspace || fallback) || 'unknown', events };
    filesProcessed++;
  }
  const state: BucketAccumulator = new Map(), seen = new Set<string>();
  for (const file of orderedMuseFiles(files)) for (const event of file.events) {
    if (seen.has(event.id) || Date.parse(event.timestamp) < since) continue;
    seen.add(event.id);
    const hour = toUtcHalfHourStart(event.timestamp);
    if (hour) accumulateBucket(state, 'muse', event.model, file.project, hour, event.tokens, 'muse-cli');
  }
  const buckets = bucketsFromState(state, 'muse');
  const old = new Map((previous?.buckets ?? []).map(row => [bucketKey(row), row]));
  const current = new Map(buckets.map(row => [bucketKey(row), row]));
  const deltas: QueueBucket[] = [];
  for (const key of new Set([...old.keys(), ...current.keys()])) {
    const before = old.get(key), after = current.get(key), delta = { ...(after ?? before!) };
    for (const field of fields) delta[field] = (after?.[field] ?? 0) - (before?.[field] ?? 0);
    if (fields.some(field => delta[field] !== 0)) deltas.push(delta);
    eventsParsed += Math.max(0, delta.conversation_count);
  }
  cursors.muse = { since: statsSince, files, buckets };
  return { result: { buckets: deltas, eventsParsed, filesProcessed }, cursors };
}
