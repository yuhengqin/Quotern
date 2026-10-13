/**
 * Kimi passive reader (source `kimi`).
 *
 * CLI: `kimi-code` (~/.kimi-code) preferred over `kimi-legacy` (~/.kimi).
 * Desktop: its embedded Code runtime is collected independently. Shared event
 * IDs prevent copied sessions from being counted twice across the homes.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createJsonlLineReader } from './jsonl-tail.js';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { kimiDesktopCodeHome } from '../paths.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';

export const KIMI_COLLECTOR_CODE = 'kimi-code';
export const KIMI_COLLECTOR_LEGACY = 'kimi-legacy';
export const KIMI_COLLECTOR_DESKTOP = 'kimi-desktop';

type KimiExtCursors = CursorsFile & {
  kimi?: {
    seenIds?: string[];
    fileOffsets?: Record<
      string,
      { inode: number; size: number; mtimeMs: number; offset: number; model?: string }
    >;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

function kimiCodeHome(): string {
  const env = process.env.KIMI_CODE_HOME?.trim();
  return env ? expandHome(env) : join(homedir(), '.kimi-code');
}

function kimiLegacyHome(): string {
  const env = process.env.KIMI_HOME?.trim();
  return env ? expandHome(env) : join(homedir(), '.kimi');
}

function walkWireFiles(sessionsDir: string, depth = 0): string[] {
  const out: string[] = [];
  if (depth > 6 || !existsSync(sessionsDir)) return out;
  let entries;
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(sessionsDir, ent.name);
    if (ent.isDirectory()) out.push(...walkWireFiles(full, depth + 1));
    else if (ent.name === 'wire.jsonl') out.push(full);
  }
  return out;
}

export function resolveKimiCodeWireFiles(home = kimiCodeHome()): string[] {
  const dir = join(home, 'sessions');
  const files = walkWireFiles(dir);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export function resolveKimiLegacyWireFiles(): string[] {
  const base = join(kimiLegacyHome(), 'sessions');
  const out: string[] = [];
  if (!existsSync(base)) return out;
  try {
    for (const workDir of readdirSync(base, { withFileTypes: true })) {
      if (!workDir.isDirectory()) continue;
      const workDirPath = join(base, workDir.name);
      for (const session of readdirSync(workDirPath, { withFileTypes: true })) {
        if (!session.isDirectory()) continue;
        const wire = join(workDirPath, session.name, 'wire.jsonl');
        if (existsSync(wire)) out.push(wire);
      }
    }
  } catch {
    // ignore
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function projectNameFromPath(p: string): string {
  return resolveProjectName(p);
}

function loadKimiCodeSessionIndex(home: string): Map<string, string> {
  const map = new Map<string, string>();
  const indexPath = join(home, 'session_index.jsonl');
  if (!existsSync(indexPath)) return map;
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { sessionDir?: string; workDir?: string };
      const dir = entry.sessionDir;
      const project = entry.workDir ? projectNameFromPath(entry.workDir) : null;
      if (typeof dir === 'string' && dir && project) map.set(dir.replace(/\\/g, '/'), project);
    } catch {
      continue;
    }
  }
  return map;
}

function kimiCodeProjectForWire(filePath: string, sessionIndex: Map<string, string>): string {
  const parts = filePath.split(/[/\\]/);
  const agentsIdx = parts.lastIndexOf('agents');
  if (agentsIdx >= 2) {
    const sessionDir = parts.slice(0, agentsIdx).join('/');
    const indexed = sessionIndex.get(sessionDir);
    if (indexed) return indexed;
  }
  const wdPart = parts.find((p) => /^wd_.+_[0-9a-f]+$/.test(p));
  if (wdPart) {
    const m = /^wd_(.+)_[0-9a-f]+$/.exec(wdPart);
    if (m?.[1]) return m[1];
  }
  return 'unknown';
}

function loadLegacyProjectMap(): Map<string, string> {
  const map = new Map<string, string>();
  const jsonPath = join(kimiLegacyHome(), 'kimi.json');
  if (!existsSync(jsonPath)) return map;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return map;
  }
  const workDirs = config.work_dirs;
  if (Array.isArray(workDirs)) {
    for (const entry of workDirs) {
      const path = (entry as { path?: string })?.path;
      if (typeof path === 'string' && path) {
        map.set(createHash('md5').update(path).digest('hex'), projectNameFromPath(path));
      }
    }
  }
  for (const key of ['workspaces', 'projects'] as const) {
    const obj = config[key];
    if (!obj || typeof obj !== 'object') continue;
    for (const [hash, info] of Object.entries(obj as Record<string, unknown>)) {
      const path =
        typeof info === 'string' ? info : (info as { path?: string; dir?: string })?.path ?? (info as { dir?: string })?.dir;
      if (typeof path === 'string' && path) map.set(hash, projectNameFromPath(path));
    }
  }
  return map;
}

function resolveKimiLegacyDefaultModel(): string {
  const fallback = 'kimi-for-coding';
  const cfgPath = join(kimiLegacyHome(), 'config.toml');
  if (!existsSync(cfgPath)) return fallback;
  try {
    const raw = readFileSync(cfgPath, 'utf-8');
    const defaultMatch = raw.match(/^\s*default_model\s*=\s*"([^"]+)"/m);
    if (!defaultMatch?.[1]) return fallback;
    const sectionKey = defaultMatch[1];
    const escaped = sectionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRe = new RegExp(`\\[models\\."${escaped}"\\]([\\s\\S]*?)(?:\\n\\[|$)`);
    const section = raw.match(sectionRe);
    if (section?.[1]) {
      const modelMatch = section[1].match(/^\s*model\s*=\s*"([^"]+)"/m);
      if (modelMatch?.[1]) return modelMatch[1];
    }
    if (sectionKey.includes('/')) return sectionKey.split('/').pop() || fallback;
    return sectionKey || fallback;
  } catch {
    return fallback;
  }
}

function resolveKimiCodeDefaultModel(home: string): string {
  const fallback = 'kimi-for-coding';
  const cfgPath = join(home, 'config.toml');
  if (!existsSync(cfgPath)) return fallback;
  try {
    const raw = readFileSync(cfgPath, 'utf-8');
    const m = raw.match(/^\s*default_model\s*=\s*"([^"]+)"/m);
    if (!m?.[1]) return fallback;
    return m[1].includes('/') ? m[1].split('/').pop() || fallback : m[1] || fallback;
  } catch {
    return fallback;
  }
}

function kimiCodeModelAlias(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.includes('/') ? value.split('/').pop() || null : value;
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function normalizeKimiCodeUsage(usage: Record<string, unknown>): Omit<TokenTotals, 'conversation_count'> | null {
  let input: number;
  let output: number;
  let cacheRead: number;
  let cacheCreation: number;

  if (usage.inputOther != null) {
    input = toNonNeg(usage.inputOther);
    cacheRead = toNonNeg(usage.inputCacheRead);
    cacheCreation = toNonNeg(usage.inputCacheCreation);
    output = toNonNeg(usage.output);
  } else {
    cacheCreation = toNonNeg(usage.cache_creation_input_tokens);
    if (usage.cache_read_input_tokens != null) {
      cacheRead = toNonNeg(usage.cache_read_input_tokens);
      input = toNonNeg(usage.input_tokens);
    } else {
      const details =
        usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
          ? (usage.input_tokens_details as Record<string, unknown>)
          : null;
      cacheRead = toNonNeg(details?.cached_tokens);
      input = Math.max(0, toNonNeg(usage.input_tokens) - cacheRead);
    }
    output = toNonNeg(usage.output_tokens);
  }

  const delta = {
    input_tokens: input,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    output_tokens: output,
    reasoning_output_tokens: 0,
  };
  const total = computeTotalTokens(delta);
  if (total === 0) return null;
  return { ...delta, total_tokens: total };
}

function ingestDelta(
  bucketState: BucketAccumulator,
  collector: string,
  model: string,
  project: string,
  hourStart: string,
  delta: Omit<TokenTotals, 'conversation_count'>,
): void {
  accumulateBucket(
    bucketState,
    'kimi',
    model,
    project,
    hourStart,
    { ...delta, conversation_count: 1 },
    collector,
  );
}

async function parseKimiCodeWireFile(opts: {
  filePath: string;
  collector: string;
  sinceMs: number;
  seenIds: Set<string>;
  fileOffsets: Record<string, { inode: number; size: number; mtimeMs: number; offset: number; model?: string }>;
  sessionIndex: Map<string, string>;
  fallbackModel: string;
  bucketState: BucketAccumulator;
}): Promise<{ eventsParsed: number; filesProcessed: number }> {
  const { filePath, collector, sinceMs, seenIds, fileOffsets, sessionIndex, fallbackModel, bucketState } = opts;
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { eventsParsed: 0, filesProcessed: 0 };

  const prev = fileOffsets[filePath];
  const inode = st.ino;
  const sameInode = prev && prev.inode === inode;
  const truncated = sameInode && (prev.offset ?? 0) > st.size;
  const startOffset = sameInode && !truncated ? (prev.offset ?? 0) : 0;
  if (sameInode && !truncated && startOffset >= st.size) return { eventsParsed: 0, filesProcessed: 0 };

  let fileModel = (typeof prev?.model === 'string' && prev.model) || fallbackModel;
  const project = kimiCodeProjectForWire(filePath, sessionIndex);
  let eventsParsed = 0;

  const reader = createJsonlLineReader(filePath, startOffset);

  for await (const line of reader) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry.type === 'config.update') {
      const alias = kimiCodeModelAlias(entry.modelAlias);
      if (alias) fileModel = alias;
      continue;
    }

    const evt =
      entry.type === 'context.append_loop_event' &&
      entry.event &&
      typeof entry.event === 'object'
        ? (entry.event as Record<string, unknown>)
        : entry;
    if (!evt || evt.type !== 'step.end') continue;

    const usage = evt.usage;
    if (!usage || typeof usage !== 'object') continue;
    const id = typeof evt.uuid === 'string' ? evt.uuid : null;
    if (!id || seenIds.has(id)) continue;

    const delta = normalizeKimiCodeUsage(usage as Record<string, unknown>);
    if (!delta) {
      seenIds.add(id);
      continue;
    }

    const ms = entry.time ?? evt.time;
    if (ms == null || !Number.isFinite(Number(ms))) continue;
    const hourStart = toUtcHalfHourStart(new Date(Number(ms)).toISOString());
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

    ingestDelta(bucketState, collector, fileModel, project, hourStart, delta);
    seenIds.add(id);
    eventsParsed += 1;
  }

  fileOffsets[filePath] = {
    inode,
    size: reader.nextOffset,
    mtimeMs: st.mtimeMs,
    offset: reader.nextOffset,
    model: fileModel,
  };
  return { eventsParsed, filesProcessed: 1 };
}

async function parseKimiLegacyWireFile(opts: {
  filePath: string;
  sinceMs: number;
  seenIds: Set<string>;
  fileOffsets: Record<string, { inode: number; size: number; mtimeMs: number; offset: number; model?: string }>;
  projectMap: Map<string, string>;
  defaultModel: string;
  bucketState: BucketAccumulator;
}): Promise<{ eventsParsed: number; filesProcessed: number }> {
  const { filePath, sinceMs, seenIds, fileOffsets, projectMap, defaultModel, bucketState } = opts;
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { eventsParsed: 0, filesProcessed: 0 };

  const prev = fileOffsets[filePath];
  const inode = st.ino;
  const sameInode = prev && prev.inode === inode;
  const truncated = sameInode && (prev.offset ?? 0) > st.size;
  const startOffset = sameInode && !truncated ? (prev.offset ?? 0) : 0;
  if (sameInode && !truncated && startOffset >= st.size) return { eventsParsed: 0, filesProcessed: 0 };

  const parts = filePath.split(/[/\\]/);
  const sessionsIdx = parts.lastIndexOf('sessions');
  const workDirHash = sessionsIdx >= 0 && parts[sessionsIdx + 1] ? parts[sessionsIdx + 1]! : 'unknown';
  const project = projectMap.get(workDirHash) || workDirHash;

  let currentModel = defaultModel;
  let eventsParsed = 0;

  const reader = createJsonlLineReader(filePath, startOffset);

  for await (const line of reader) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const msg = entry.message as { type?: string; payload?: Record<string, unknown> } | undefined;
    if (!msg || msg.type !== 'StatusUpdate') continue;
    const payload = msg.payload;
    if (!payload) continue;

    if (typeof payload.model === 'string' && payload.model) currentModel = payload.model;

    const tokenUsage = payload.token_usage as Record<string, unknown> | undefined;
    const messageId = payload.message_id;
    if (!tokenUsage || typeof messageId !== 'string' || !messageId) continue;
    if (seenIds.has(messageId)) continue;

    const input = toNonNeg(tokenUsage.input_other);
    const output = toNonNeg(tokenUsage.output);
    const cacheRead = toNonNeg(tokenUsage.input_cache_read);
    const cacheCreation = toNonNeg(tokenUsage.input_cache_creation);
    if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) {
      seenIds.add(messageId);
      continue;
    }

    const epochSec = entry.timestamp ?? payload.timestamp;
    if (epochSec == null || !Number.isFinite(Number(epochSec))) continue;
    const hourStart = toUtcHalfHourStart(new Date(Number(epochSec) * 1000).toISOString());
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

    const delta = {
      input_tokens: input,
      cached_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreation,
      output_tokens: output,
      reasoning_output_tokens: 0,
      total_tokens: input + output + cacheRead + cacheCreation,
    };
    ingestDelta(bucketState, KIMI_COLLECTOR_LEGACY, currentModel, project, hourStart, delta);
    seenIds.add(messageId);
    eventsParsed += 1;
  }

  fileOffsets[filePath] = {
    inode,
    size: reader.nextOffset,
    mtimeMs: st.mtimeMs,
    offset: reader.nextOffset,
  };
  return { eventsParsed, filesProcessed: 1 };
}

export interface ParseKimiResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseKimiIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseKimiResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as KimiExtCursors;
  if (!ext.kimi) {
    ext.kimi = { seenIds: [], fileOffsets: {} };
  }
  if (!ext.kimi.fileOffsets) ext.kimi.fileOffsets = {};
  const seenIds = new Set(ext.kimi.seenIds ?? []);
  const fileOffsets = ext.kimi.fileOffsets;
  const bucketState: BucketAccumulator = new Map();

  let eventsParsed = 0;
  let filesProcessed = 0;

  const codeFiles = resolveKimiCodeWireFiles();
  const desktopHome = kimiDesktopCodeHome();
  const codeSources = [
    { home: kimiCodeHome(), files: codeFiles, collector: KIMI_COLLECTOR_CODE },
    { home: desktopHome, files: resolveKimiCodeWireFiles(desktopHome), collector: KIMI_COLLECTOR_DESKTOP },
  ];
  const processedFiles = new Set<string>();
  for (const { home, files, collector } of codeSources) {
    if (files.length === 0) continue;
    const sessionIndex = loadKimiCodeSessionIndex(home);
    const fallbackModel = resolveKimiCodeDefaultModel(home);
    for (const filePath of files) {
      if (processedFiles.has(filePath)) continue;
      processedFiles.add(filePath);
      const parsed = await parseKimiCodeWireFile({
        filePath,
        collector,
        sinceMs,
        seenIds,
        fileOffsets,
        sessionIndex,
        fallbackModel,
        bucketState,
      });
      eventsParsed += parsed.eventsParsed;
      filesProcessed += parsed.filesProcessed;
    }
  }
  if (codeFiles.length === 0) {
    const legacyFiles = resolveKimiLegacyWireFiles();
    const projectMap = loadLegacyProjectMap();
    const defaultModel = resolveKimiLegacyDefaultModel();
    for (const filePath of legacyFiles) {
      const parsed = await parseKimiLegacyWireFile({
        filePath,
        sinceMs,
        seenIds,
        fileOffsets,
        projectMap,
        defaultModel,
        bucketState,
      });
      eventsParsed += parsed.eventsParsed;
      filesProcessed += parsed.filesProcessed;
    }
  }

  ext.kimi.seenIds = Array.from(seenIds).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'kimi'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
