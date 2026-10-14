import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { createJsonlLineReader } from './parsers/jsonl-tail.js';
import {
  discoverSessionInputs, extractSessionMessage, readSessionSnapshot,
  type CollectedSessionMessage, type SessionFileContext, type SessionInput,
} from './session-sources.js';
import { aggregateSessionMetrics, type SessionMetricOptions, type SessionMetrics } from './session-metrics.js';

const VERSION = 3;
interface FileSnapshot {
  complete: boolean;
  size: number;
  mtimeMs: number;
  ino: number;
  offset: number;
  guard: string;
  context: SessionFileContext;
  messages: Record<string, CollectedSessionMessage>;
}
interface SourceSnapshot {
  version: number;
  source: string;
  complete: boolean;
  files: Record<string, FileSnapshot>;
}
const cache = new Map<string, { stamp: string; value: SourceSnapshot }>();
const sourcePath = (dataDir: string, source: string) => join(dataDir, 'sessions', `${source}.json`);
const validSource = (source: string) => /^[a-z][a-z0-9-]*$/.test(source);

async function loadSource(path: string, source: string): Promise<SourceSnapshot | null> {
  try {
    const st = await stat(path), stamp = `${st.mtimeMs}:${st.size}`;
    const hit = cache.get(path);
    if (hit?.stamp === stamp) return hit.value;
    const value = JSON.parse(await readFile(path, 'utf8')) as SourceSnapshot;
    if (value.version !== VERSION || value.source !== source || !value.files || typeof value.files !== 'object') return null;
    cache.set(path, { stamp, value });
    return value;
  } catch { return null; }
}

/** Verify the entire consumed prefix, including in-place middle rewrites. */
async function prefixGuard(path: string, size: number): Promise<string> {
  const digest = createHash('sha256');
  if (size > 0) {
    for await (const chunk of createReadStream(path, { start: 0, end: size - 1 })) digest.update(chunk as Buffer);
  }
  return digest.digest('hex');
}

function materialize(snapshot: SourceSnapshot): { messages: CollectedSessionMessage[]; complete: boolean } {
  const groups = new Map<string, { parentId?: string; messages: Map<string, CollectedSessionMessage> }>();
  let complete = snapshot.complete;
  for (const file of Object.values(snapshot.files)) {
    for (const message of Object.values(file.messages)) {
      if (snapshot.source === 'kimi' && file.context.kimiCanonicalAssistant && message.id.startsWith('step:')) continue;
      if (snapshot.source === 'dsh' && file.context.parentId && message.seq !== undefined && message.seq <= (file.context.inheritedThrough ?? -1)) continue;
      const group = groups.get(message.sessionId) ?? { parentId: file.context.parentId, messages: new Map() };
      group.parentId ??= file.context.parentId;
      const previous = group.messages.get(message.id);
      if (!previous || message.timestamp > previous.timestamp) group.messages.set(message.id, message);
      groups.set(message.sessionId, group);
    }
  }
  const result: CollectedSessionMessage[] = [];
  for (const group of groups.values()) {
    const rows = [...group.messages.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let copied = 0;
    if (group.parentId && snapshot.source === 'codex') {
      const parent = groups.get(group.parentId);
      if (!parent) complete = false;
      else {
        const originals = [...parent.messages.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        for (let start = 0; start < originals.length; start++) {
          let length = 0;
          while (length < rows.length && start + length < originals.length
            && rows[length]!.replayKey && rows[length]!.replayKey === originals[start + length]!.replayKey
            && (rows[length]!.id === originals[start + length]!.id || rows[length]!.timestamp === originals[start + length]!.timestamp)) length++;
          copied = Math.max(copied, length);
        }
      }
    }
    result.push(...rows.slice(copied));
  }
  return { messages: result, complete };
}

async function saveSource(path: string, value: SourceSnapshot): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    for (let attempt = 0;; attempt++) {
      try { await rename(temporary, path); break; }
      catch (error) {
        if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    cache.delete(path);
  } finally { await unlink(temporary).catch(() => {}); }
}

/** Independent cursors allow initial backfill even when Token parsing is at EOF. */
export async function syncSessionSource(
  dataDir: string,
  source: string,
  discovered?: { inputs: SessionInput[]; complete: boolean },
): Promise<boolean> {
  if (!validSource(source)) throw new Error('invalid_session_source');
  const discovery = discovered ?? await discoverSessionInputs(source);
  // Unsupported sources have no input adapter. Their presence is reported by
  // readSessionMetrics using the actual usage sources, without creating files.
  if (!discovery.complete && discovery.inputs.length === 0) return false;
  const dir = join(dataDir, 'sessions');
  await mkdir(dir, { recursive: true });
  const path = sourcePath(dataDir, source);
  const release = await lock(path, { realpath: false, retries: { retries: 10, minTimeout: 25, maxTimeout: 250 }, stale: 60_000 });
  try {
    const previous = await loadSource(path, source);
    const next: SourceSnapshot = { version: VERSION, source, complete: discovery.complete, files: { ...(previous?.files ?? {}) } };
    let dirty = !previous || previous.complete !== next.complete;
    for (const input of discovery.inputs) {
      try {
        const st = await stat(input.path);
        const old = next.files[input.path];
        const dbStamp = input.kind === 'sqlite' ? await stat(`${input.path}-wal`).catch(() => null) : null;
        const mtimeMs = Math.max(st.mtimeMs, dbStamp?.mtimeMs ?? 0);
        const size = st.size + (dbStamp?.size ?? 0);
        if (old?.complete && old.size === size && old.mtimeMs === mtimeMs && old.ino === st.ino && old.offset === st.size) continue;
        let append = false;
        if (old?.complete && input.kind === 'jsonl' && old.ino === st.ino && st.size > old.offset && old.size <= st.size) {
          append = old.guard === await prefixGuard(input.path, old.offset);
        }
        const context: SessionFileContext = append ? { ...old!.context } : { sessionId: input.sessionId };
        const messages = append ? { ...old!.messages } : {};
        let fileComplete = true;
        let offset = st.size;
        if (input.kind === 'jsonl') {
          const reader = createJsonlLineReader(input.path, append ? old!.offset : 0);
          for await (const line of reader) {
            let record: Record<string, unknown>;
            try { record = JSON.parse(line) as Record<string, unknown>; } catch { fileComplete = false; continue; }
            const message = extractSessionMessage(source, record, context);
            if (message) messages[JSON.stringify([message.sessionId, message.id])] = message;
          }
          offset = reader.nextOffset;
        } else {
          for (const message of readSessionSnapshot(input, source, context)) messages[JSON.stringify([message.sessionId, message.id])] = message;
        }
        fileComplete = fileComplete && !context.incomplete && (source !== 'kimi' || context.kimiContext === true);
        if (source === 'codex' && context.legacyCodexMessages && !context.canonicalCodexMessages) fileComplete = false;
        next.files[input.path] = { complete: fileComplete, size, mtimeMs, ino: st.ino, offset, guard: input.kind === 'jsonl' ? await prefixGuard(input.path, offset) : '', context, messages };
        dirty = true;
      } catch {
        // A locked DB, incomplete JSON snapshot or temporary read error keeps
        // the last successful metadata instead of turning known history to 0.
        next.complete = false;
        const old = next.files[input.path];
        next.files[input.path] = old ? { ...old, complete: false } : {
          complete: false, size: 0, mtimeMs: 0, ino: 0, offset: 0, guard: '',
          context: { sessionId: input.sessionId }, messages: {},
        };
        dirty = true;
      }
    }
    next.complete = next.complete && Object.values(next.files).every((file) => file.complete);
    if (previous?.complete !== next.complete) dirty = true;
    if (!dirty) return false;
    const before = previous ? materialize(previous) : null;
    const after = materialize(next);
    const changed = !before || before.complete !== after.complete || JSON.stringify(before.messages) !== JSON.stringify(after.messages);
    await saveSource(path, next);
    return changed;
  } finally { await release(); }
}

export async function readSessionMetrics(
  dataDir: string,
  usageSources: readonly string[],
  options: SessionMetricOptions = {},
): Promise<SessionMetrics> {
  const files = await readdir(join(dataDir, 'sessions')).catch(() => [] as string[]);
  const sources = new Set([...usageSources, ...(options.sources ?? []), ...files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5))]);
  const messages: CollectedSessionMessage[] = [];
  const missingSources: string[] = [];
  for (const source of sources) {
    if (!validSource(source)) continue;
    if (options.sources?.length && !options.sources.includes(source)) continue;
    const stored = await loadSource(sourcePath(dataDir, source), source);
    if (!stored) { if (usageSources.includes(source) || options.sources?.includes(source)) missingSources.push(source); continue; }
    const result = materialize(stored);
    messages.push(...result.messages);
    const inRange = aggregateSessionMetrics(result.messages, options).sessionCount > 0;
    if ((usageSources.includes(source) || options.sources?.includes(source) || inRange) && (!result.complete || (usageSources.includes(source) && result.messages.length === 0))) missingSources.push(source);
  }
  return aggregateSessionMetrics(messages, { ...options, missingSources });
}
