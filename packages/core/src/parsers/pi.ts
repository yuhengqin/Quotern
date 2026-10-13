/**
 * paths.ts exports needed:
 *   piSessionsDir(): string  — $PI_CODING_AGENT_DIR/sessions or ~/.pi/agent/sessions
 *   findPiSessionFiles(sessionsDir?: string): string[]
 */
import { existsSync, readdirSync } from 'node:fs';
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

export const PI_COLLECTOR = 'pi';

interface PiFileCursor {
  inode: number;
  offset: number;
}

interface PiCursors {
  files: Record<string, PiFileCursor>;
  seenIds: string[];
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function normalizePiUsage(
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

/** Pi agent sessions directory. */
export function piSessionsDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim();
  if (env) {
    const base = env.startsWith('~') ? join(homedir(), env.slice(1)) : env;
    return join(base, 'sessions');
  }
  return join(homedir(), '.pi', 'agent', 'sessions');
}

/** Recursively find session JSONL files under sessions/<encoded-cwd>/. */
export function findPiSessionFiles(sessionsDir = piSessionsDir()): string[] {
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

export interface ParsePiResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parsePiIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParsePiResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const piRoot = (cursors as CursorsFile & { pi?: PiCursors }).pi;
  if (!piRoot) {
    (cursors as CursorsFile & { pi: PiCursors }).pi = { files: {}, seenIds: [] };
  }
  const pi = (cursors as CursorsFile & { pi: PiCursors }).pi;
  if (!pi.files) pi.files = {};
  const fileCursors = pi.files;
  const seenIds = new Set(pi.seenIds ?? []);
  const bucketState: BucketAccumulator = new Map();
  const sessionsDir = piSessionsDir();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of findPiSessionFiles(sessionsDir)) {
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

      const delta = normalizePiUsage(msg.usage);
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

      const model = typeof msg.model === 'string' && msg.model ? msg.model : 'pi-unknown';
      accumulateBucket(
        bucketState,
        'pi',
        model,
        project,
        hourStart,
        { ...delta, conversation_count: 1 },
        PI_COLLECTOR,
      );
      seenIds.add(entryId);
      eventsParsed += 1;
    }

    fileCursors[filePath] = { inode, offset: reader.nextOffset };
    filesProcessed += 1;
  }

  pi.seenIds = Array.from(seenIds).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'pi'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
