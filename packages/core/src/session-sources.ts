import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { geminiHome, kimiDesktopCodeHome, opencodeDbPath, opencodeMessagesDir } from './paths.js';
import { listClaudeProjectFiles } from './parsers/claude.js';
import { listCodexRolloutFiles } from './parsers/codex.js';
import { findCopilotEventFiles } from './parsers/copilot.js';
import { findGeminiSessionFiles } from './parsers/gemini.js';
import { findPiSessionFiles } from './parsers/pi.js';
import { listDshSessionFiles, decodeDsh } from './parsers/dsh.js';
import { resolveKimiCodeWireFiles, resolveKimiLegacyWireFiles } from './parsers/kimi.js';
import { antigravityProjectFromPath, listAntigravityTranscripts } from './parsers/antigravity.js';
import { zcodeDbPath, isZcodeNativeMessage } from './parsers/zcode.js';
import { queryDbJson, readSqliteWithSnapshot } from './parsers/sqlite.js';
import type { SessionMessage } from './session-metrics.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' ? value as ObjectValue : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value) ?? '').digest('hex');

export interface SessionFileContext {
  sessionId: string;
  parentId?: string;
  recordIndex?: number;
  inheritedThrough?: number;
  version?: number;
  metadataSeen?: boolean;
  incomplete?: boolean;
  kimiContext?: boolean;
  kimiCanonicalAssistant?: boolean;
  legacyCodexMessages?: boolean;
  canonicalCodexMessages?: boolean;
}

export interface CollectedSessionMessage extends SessionMessage {
  /** Content is hashed transiently for copied-history matching, never stored. */
  replayKey?: string;
  seq?: number;
}

export interface SessionInput {
  path: string;
  sessionId: string;
  kind: 'jsonl' | 'json' | 'zstd' | 'sqlite';
}

export const SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode', 'copilot', 'pi', 'dsh', 'antigravity', 'zcode', 'kimi']);

export function sessionTimestamp(value: unknown, milliseconds = false): string | null {
  if (value === null || value === undefined || value === '') return null;
  let stamp: number;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value);
    stamp = milliseconds || n >= 1e12 ? n : n * 1000;
  } else stamp = Date.parse(String(value));
  return Number.isFinite(stamp) && Math.abs(stamp) < 8.64e15 ? new Date(stamp).toISOString() : null;
}

function humanContent(content: unknown): boolean {
  if (!Array.isArray(content)) return true;
  return content.length === 0 || content.some((block) => !['tool_result', 'tool_use', 'function_call', 'function_call_output'].includes(string(object(block).type)));
}

/** Extract messages before any usage/token filtering. Event mirrors are excluded. */
export function extractSessionMessage(source: string, record: ObjectValue, context: SessionFileContext): CollectedSessionMessage | null {
  context.recordIndex = (context.recordIndex ?? 0) + 1;
  const payload = object(record.payload);
  let body = object(record.message);
  let role: unknown;
  let id: unknown;
  let content: unknown;
  let timestamp: unknown = record.timestamp ?? (typeof record.time === 'object' ? undefined : record.time) ?? record.created_at;
  if (source === 'codex') {
    if (record.type === 'event_msg' && ['user_message', 'agent_message'].includes(string(payload.type ?? object(payload.msg).type))) {
      context.legacyCodexMessages = true;
      return null;
    }
    if (record.type === 'session_meta') {
      if (!context.metadataSeen) {
        context.sessionId = string(payload.id) || context.sessionId;
        context.parentId = string(payload.forked_from_id) || undefined;
        context.metadataSeen = true;
      }
      return null;
    }
    if (record.type !== 'response_item' || payload.type !== 'message') return null;
    body = payload;
    role = body.role;
    if (role === 'user' || role === 'assistant') context.canonicalCodexMessages = true;
    id = body.id;
    content = body.content;
  } else if (source === 'claude') {
    context.sessionId = string(record.sessionId) || context.sessionId;
    role = record.type;
    id = role === 'assistant' ? body.id ?? record.uuid : record.uuid ?? body.id;
    content = body.content;
    if (record.isMeta === true || record.isCompactSummary === true) return null;
  } else if (source === 'pi') {
    if (record.type === 'session') {
      context.sessionId = string(record.id) || context.sessionId;
      return null;
    }
    if (record.type !== 'message') return null;
    role = body.role;
    id = record.id;
    content = body.content;
    timestamp ??= body.timestamp;
  } else if (source === 'copilot') {
    if (record.type !== 'user.message' && record.type !== 'assistant.message') return null;
    role = record.type === 'user.message' ? 'user' : 'assistant';
    id = record.id;
    content = object(record.data).content;
  } else if (source === 'dsh') {
    if (record.type === 'session') {
      context.sessionId = string(record.id) || context.sessionId;
      context.parentId = string(record.parentSession) || undefined;
      context.version = Number(record.version) || 0;
      if (context.version < 2) context.inheritedThrough = Number(record.seedLength) || 0;
      return null;
    }
    const data = object(record.data);
    if (record.type === 'session/end-seed' && data.inherited === true) {
      context.inheritedThrough = Number(record.seq);
      return null;
    }
    if (record.type === 'user/message' && object(data.source).kind === 'user') {
      role = 'user'; id = data.id; content = data.content;
    } else if (record.type === 'assistant/message') {
      body = object(data.message); role = 'assistant'; id = body.id; content = body.content;
    } else return null;
  } else if (source === 'antigravity') {
    role = record.type === 'USER_INPUT' ? 'user' : record.type === 'PLANNER_RESPONSE' ? 'assistant' : null;
    id = record.id ?? record.message_id;
    content = record.content;
  } else if (source === 'kimi') {
    if (record.type === 'metadata') {
      if (record.protocol_version === '1.5') context.kimiContext = true;
      return null;
    }
    if (record.type === 'context.append_loop_event') {
      const event = object(record.event), part = object(event.part);
      // Text fragments belong to a logical assistant message identified by
      // stepUuid. Thinking, tool events and usage records are not messages.
      if (event.type !== 'content.part' || part.type !== 'text') return null;
      context.kimiContext = true;
      if (!string(event.stepUuid)) { context.incomplete = true; return null; }
      role = 'assistant'; id = `step:${event.stepUuid}`; content = part.text;
    } else {
      if (!['context.append_message', 'message', 'Message', 'TurnBegin'].includes(string(record.type))) return null;
      body = object(record.message ?? payload.message);
      role = body.role ?? (record.type === 'TurnBegin' ? 'user' : undefined);
      if (record.type === 'context.append_message') context.kimiContext = true;
      const origin = string(object(body.origin).kind);
      if (role === 'user' && origin && origin !== 'user') return null;
      if (role === 'assistant') context.kimiCanonicalAssistant = true;
      id = body.id ?? record.id;
      content = body.content ?? payload.user_input;
    }
  } else {
    body = Object.keys(body).length ? body : record;
    role = body.role ?? body.type;
    if (role === 'gemini' || role === 'model') role = 'assistant';
    id = body.id ?? record.id;
    content = body.content;
    timestamp ??= body.timestamp ?? body.createTime ?? object(body.time).completed ?? object(body.time).created;
    context.sessionId = string(record.sessionID ?? record.sessionId) || context.sessionId;
  }
  if (role !== 'user' && role !== 'assistant') return null;
  if (!humanContent(content)) return null;
  const stamp = sessionTimestamp(timestamp, source === 'kimi' && record.time !== undefined);
  if (!stamp) { context.incomplete = true; return null; }
  const replayKey = content !== undefined ? hash([role, content]) : string(id) || undefined;
  return {
    source, sessionId: context.sessionId, role, timestamp: stamp,
    id: string(id) || hash([role, stamp, content]),
    replayKey,
    ...(typeof record.seq === 'number' ? { seq: record.seq } : {}),
  };
}

function walkFiles(dir: string, accept: (path: string) => boolean, depth = 0): string[] {
  if (depth > 8 || !existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(path, accept, depth + 1) : accept(path) ? [path] : [];
  });
}

export async function discoverSessionInputs(source: string): Promise<{ inputs: SessionInput[]; complete: boolean }> {
  let paths: string[] = [];
  let complete = SESSION_SOURCES.has(source);
  if (source === 'claude') paths = await listClaudeProjectFiles();
  else if (source === 'codex') paths = await listCodexRolloutFiles();
  else if (source === 'gemini') paths = findGeminiSessionFiles();
  else if (source === 'pi') paths = findPiSessionFiles();
  else if (source === 'dsh') paths = listDshSessionFiles();
  else if (source === 'copilot') return { inputs: findCopilotEventFiles().map((f) => ({ path: f.filePath, sessionId: f.sessionId, kind: 'jsonl' })), complete };
  else if (source === 'kimi') {
    paths = [...resolveKimiCodeWireFiles(), ...resolveKimiCodeWireFiles(kimiDesktopCodeHome()), ...resolveKimiLegacyWireFiles()];
  }
  else if (source === 'opencode') paths = [...(existsSync(opencodeDbPath()) ? [opencodeDbPath()] : []), ...walkFiles(opencodeMessagesDir(), (p) => p.endsWith('.json'))];
  else if (source === 'zcode') paths = existsSync(zcodeDbPath()) ? [zcodeDbPath()] : [];
  else if (source === 'antigravity') {
    const dbs: string[] = [];
    for (const variant of ['antigravity', 'antigravity-ide', 'antigravity-cli']) {
      const dir = join(geminiHome(), variant, 'conversations');
      dbs.push(...walkFiles(dir, (p) => p.endsWith('.db') && basename(p) !== 'db.sqlite'));
      if (walkFiles(dir, (p) => p.endsWith('.pb')).some((p) => !existsSync(p.slice(0, -3) + '.db'))) complete = false;
    }
    const dbIds = new Set(dbs.map((p) => basename(p, '.db')));
    paths = [...dbs, ...listAntigravityTranscripts().filter((p) => !dbIds.has(antigravityProjectFromPath(p)))];
  }
  const inputs = [...new Set(paths)].map((path): SessionInput => ({
    path,
    sessionId: source === 'antigravity' && path.endsWith('.jsonl') ? antigravityProjectFromPath(path)
      : source === 'opencode' && path.endsWith('.json') ? basename(dirname(path))
        : source === 'kimi' ? basename(/[/\\]agents[/\\]/.test(path) ? path.replace(/[/\\]agents[/\\].*$/, '') : dirname(path))
          : basename(path).replace(/\.(jsonl|json|db|sqlite|zstd)$/g, ''),
    kind: /\.(db|sqlite)$/.test(path) ? 'sqlite' : path.endsWith('.zstd') ? 'zstd' : path.endsWith('.json') ? 'json' : 'jsonl',
  }));
  return { inputs, complete };
}

/** Read only identifiers, roles and clocks from message projections. */
function databaseMessages(path: string, source: string): ObjectValue[] {
  return readSqliteWithSnapshot(path, (db) => {
    if (source === 'antigravity') return queryDbJson(db, 'SELECT idx, hex(metadata) AS metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx');
    const tables = new Set(queryDbJson(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) => row.name));
    const rows: ObjectValue[] = [];
    for (const table of ['message', 'session_message']) {
      if (!tables.has(table)) continue;
      const columns = new Set(queryDbJson(db, `PRAGMA table_info(${table})`).map((row) => row.name));
      const role = table === 'session_message' ? 'type' : "json_extract(data, '$.role')";
      const fallback = columns.has('time_created') ? ', time_created' : '';
      const provider = source === 'zcode' ? ", coalesce(json_extract(data, '$.providerID'), json_extract(data, '$.providerId')) AS providerID" : '';
      rows.push(...queryDbJson(db, `SELECT id, session_id AS sessionId, ${role} AS role,
        coalesce(json_extract(data, '$.time.completed'), json_extract(data, '$.time.created')${fallback}) AS timestamp${provider}
        FROM ${table} WHERE ${role} IN ('user', 'assistant')`));
    }
    if (!tables.has('message') && !tables.has('session_message')) throw new Error('missing_message_projection');
    return rows;
  });
}

/** Bounded protobuf decoding, selecting only source enum and timestamp. */
export function antigravityStepMessage(hex: string): { role: 'user' | 'assistant'; timestamp: string } | null {
  type Field = number | Buffer;
  function decode(buf: Buffer): Map<number, Field[]> {
    const fields = new Map<number, Field[]>();
    let pos = 0;
    const varint = () => {
      let value = 0n;
      for (let shift = 0n; shift < 70n && pos < buf.length; shift += 7n) {
        const byte = buf[pos++]!;
        value |= BigInt(byte & 127) << shift;
        if (!(byte & 128)) return Number(value);
      }
      throw new Error('invalid_protobuf');
    };
    while (pos < buf.length) {
      const tag = varint(), field = tag >>> 3, wire = tag & 7;
      if (!field) throw new Error('invalid_protobuf');
      let value: Field;
      if (wire === 0) value = varint();
      else if (wire === 2 || wire === 1 || wire === 5) {
        const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
        if (length < 0 || pos + length > buf.length) throw new Error('invalid_protobuf');
        value = buf.subarray(pos, pos + length); pos += length;
      } else throw new Error('invalid_protobuf');
      fields.set(field, [...(fields.get(field) ?? []), value]);
    }
    return fields;
  }
  const fields = decode(Buffer.from(hex, 'hex'));
  const source = fields.get(3)?.[0];
  const role = source === 4 ? 'user' : source === 2 ? 'assistant' : null;
  if (!role) return null;
  for (const field of [1, 8]) {
    const bytes = fields.get(field)?.[0];
    if (!Buffer.isBuffer(bytes)) continue;
    const timestamp = decode(bytes);
    const seconds = timestamp.get(1)?.[0], nanos = timestamp.get(2)?.[0];
    if (typeof seconds !== 'number') continue;
    const stamp = sessionTimestamp(seconds * 1000 + (typeof nanos === 'number' ? nanos / 1e6 : 0), true);
    if (stamp) return { role, timestamp: stamp };
  }
  return null;
}

export function readSessionSnapshot(input: SessionInput, source: string, context: SessionFileContext): CollectedSessionMessage[] {
  const messages: CollectedSessionMessage[] = [];
  if (input.kind === 'sqlite') {
    for (const row of databaseMessages(input.path, source)) {
      if (source === 'antigravity') {
        const decoded = antigravityStepMessage(String(row.metadata));
        if (decoded) messages.push({ source, sessionId: input.sessionId, id: String(row.idx), ...decoded });
      } else {
        if (source === 'zcode' && row.role === 'assistant' && !isZcodeNativeMessage(row)) continue;
        const stamp = sessionTimestamp(row.timestamp);
        if (!stamp || !row.sessionId || !row.id) { context.incomplete = true; continue; }
        messages.push({ source, sessionId: String(row.sessionId), id: String(row.id), role: row.role as 'user' | 'assistant', timestamp: stamp });
      }
    }
    return messages;
  }
  const raw = input.kind === 'zstd' ? decodeDsh(readFileSync(input.path)) : readFileSync(input.path, 'utf8');
  if (raw === null) throw new Error('unreadable_session');
  let records: ObjectValue[];
  if (input.kind === 'json') {
    const data = object(JSON.parse(raw));
    context.sessionId = string(data.sessionId ?? data.sessionID) || context.sessionId;
    const list = data.messages ?? data.history;
    records = Array.isArray(list) ? list.map(object) : [data];
  } else records = raw.split('\n').filter((line) => line.trim()).flatMap((line) => {
    try { return [object(JSON.parse(line))]; } catch { context.incomplete = true; return []; }
  });
  for (const record of records) {
    const message = extractSessionMessage(source, record, context);
    if (message) messages.push(message);
  }
  return messages;
}
