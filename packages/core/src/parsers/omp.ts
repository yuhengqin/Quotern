/**
 * oh-my-pi (omp) passive JSONL reader — same on-disk format as pi-coding-agent.
 */
import { existsSync, realpathSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createJsonlLineReader } from './jsonl-tail.js';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';
import { piSessionsDir } from './pi.js';

export const OMP_COLLECTOR = 'omp';

interface OmpFileCursor {
  inode: number;
  offset: number;
}

interface OmpCursors {
  files: Record<string, OmpFileCursor>;
  seenIds: string[];
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function normalizeOmpUsage(
  usage: Record<string, unknown>,
): Omit<TokenTotals, 'conversation_count'> | null {
  const input = toNonNeg(usage.input);
  const output = toNonNeg(usage.output);
  const cacheRead = toNonNeg(usage.cacheRead);
  const cacheWrite = toNonNeg(usage.cacheWrite);
  const reasoning = toNonNeg(usage.reasoningTokens);
  const reportedTotal = toNonNeg(usage.totalTokens);
  const delta = {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    reasoning_output_tokens: reasoning,
  };
  const computedTotal = computeTotalTokens(delta);
  const total = Math.max(reportedTotal, computedTotal);
  if (total === 0) return null;
  return { ...delta, total_tokens: total };
}

function coerceTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function extractProjectFromCwd(cwd: string): string {
  return resolveProjectName(cwd);
}

function extractProjectFromDir(filePath: string, sessionsDir: string): string {
  const prefix = sessionsDir.endsWith('/') ? sessionsDir : `${sessionsDir}/`;
  const relative = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : '';
  const firstSeg = relative.split('/')[0];
  if (!firstSeg) return 'unknown';
  const parts = firstSeg.split('-').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : firstSeg;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

function resolveDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** oh-my-pi agent sessions directory. */
export function ompSessionsDir(): string {
  const agentDirEnv = process.env.AI_USAGE_OMP_AGENT_DIR?.trim();
  if (agentDirEnv) {
    return join(expandHome(agentDirEnv), 'sessions');
  }
  const ompHome = process.env.OMP_HOME?.trim();
  if (ompHome) {
    return join(expandHome(ompHome), 'agent', 'sessions');
  }
  return join(homedir(), '.omp', 'agent', 'sessions');
}

/** True when omp and pi resolve to the same sessions directory. */
export function ompAgentDirCollidesWithPi(): boolean {
  return resolveDir(ompSessionsDir()) === resolveDir(piSessionsDir());
}

/** Recursively find session JSONL files under sessions/<encoded-cwd>/. */
export function findOmpSessionFiles(sessionsDir = ompSessionsDir()): string[] {
  const results: string[] = [];
  if (!existsSync(sessionsDir)) return results;

  try {
    for (const cwdDir of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!cwdDir.isDirectory()) continue;
      const cwdPath = join(sessionsDir, cwdDir.name);
      let entries: string[];
      try {
        entries = readdirSync(cwdPath);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.endsWith('.jsonl')) {
          results.push(join(cwdPath, entry));
        }
      }
    }
  } catch {
    return results;
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

export interface ParseOmpResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseOmpIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseOmpResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const ompRoot = (cursors as CursorsFile & { omp?: OmpCursors }).omp;
  if (!ompRoot) {
    (cursors as CursorsFile & { omp: OmpCursors }).omp = { files: {}, seenIds: [] };
  }
  const omp = (cursors as CursorsFile & { omp: OmpCursors }).omp;
  if (!omp.files) omp.files = {};
  const fileCursors = omp.files;
  const seenIds = new Set(omp.seenIds ?? []);
  const bucketState: BucketAccumulator = new Map();
  const sessionsDir = ompSessionsDir();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of findOmpSessionFiles(sessionsDir)) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileCursors[filePath];
    const inode = st.ino;
    const sameInode = prev && prev.inode === inode;
    const truncated = sameInode && (prev.offset ?? 0) > st.size;
    const startOffset = sameInode && !truncated ? (prev.offset ?? 0) : 0;
    if (sameInode && !truncated && startOffset >= st.size) continue;

    let project = extractProjectFromDir(filePath, sessionsDir);
    const reader = createJsonlLineReader(filePath, startOffset);

    for await (const line of reader) {
      if (!line.trim()) continue;

      let entry: {
        id?: string;
        type?: string;
        timestamp?: unknown;
        cwd?: string;
        message?: {
          role?: string;
          model?: string;
          timestamp?: unknown;
          usage?: Record<string, unknown>;
        };
      };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === 'session') {
        if (typeof entry.cwd === 'string' && entry.cwd.trim()) {
          project = extractProjectFromCwd(entry.cwd);
        }
        continue;
      }

      if (entry.type !== 'message') continue;
      const msg = entry.message;
      if (!msg || msg.role !== 'assistant') continue;
      if (!msg.usage || typeof msg.usage !== 'object') continue;

      const entryId = typeof entry.id === 'string' && entry.id ? entry.id : null;
      if (!entryId) continue;
      if (seenIds.has(entryId)) continue;

      const delta = normalizeOmpUsage(msg.usage);
      if (!delta) {
        seenIds.add(entryId);
        continue;
      }

      const tsMs =
        coerceTimestampMs(msg.timestamp) ??
        coerceTimestampMs(entry.timestamp);
      if (tsMs == null) {
        seenIds.add(entryId);
        continue;
      }

      const tsIso = new Date(tsMs).toISOString();
      const hourStart = toUtcHalfHourStart(tsIso);
      if (!hourStart) {
        seenIds.add(entryId);
        continue;
      }
      if (new Date(hourStart).getTime() < sinceMs) {
        seenIds.add(entryId);
        continue;
      }

      const model = typeof msg.model === 'string' && msg.model ? msg.model : 'omp-unknown';
      accumulateBucket(
        bucketState,
        'omp',
        model,
        project,
        hourStart,
        { ...delta, conversation_count: 1 },
        OMP_COLLECTOR,
      );
      seenIds.add(entryId);
      eventsParsed += 1;
    }

    fileCursors[filePath] = { inode, offset: reader.nextOffset };
    filesProcessed += 1;
  }

  omp.seenIds = Array.from(seenIds).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'omp'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
