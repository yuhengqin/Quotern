/**
 * Qwen Code passive reader (source `qwen`, collector `qwen-code`).
 *
 * Gemini CLI fork: ~/.qwen/tmp/<project_id>/chats/*.jsonl
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
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

export const QWEN_COLLECTOR = 'qwen-code';

type QwenTotals = Omit<TokenTotals, 'conversation_count'>;

type QwenExtCursors = CursorsFile & {
  qwen?: {
    seenIds?: string[];
    files?: Record<string, { inode: number; size: number; mtimeMs: number }>;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function qwenTmpDir(): string {
  const env = process.env.QWEN_TMP_DIR?.trim();
  return env ? expandHome(env) : join(homedir(), '.qwen', 'tmp');
}

export function findQwenSessionFiles(baseDir = qwenTmpDir()): string[] {
  const results: string[] = [];
  if (!existsSync(baseDir)) return results;

  let projectDirs;
  try {
    projectDirs = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const chatsDir = join(baseDir, entry.name, 'chats');
    if (!existsSync(chatsDir)) continue;
    let files;
    try {
      files = readdirSync(chatsDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (name.endsWith('.jsonl')) {
        results.push(join(chatsDir, name));
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function normalizeUsageMetadata(u: Record<string, unknown>): QwenTotals | null {
  const cached = toNonNeg(u.cachedContentTokenCount);
  const thoughts = toNonNeg(u.thoughtsTokenCount);
  const prompt = toNonNeg(u.promptTokenCount ?? u.input_tokens);
  const candidates = toNonNeg(u.candidatesTokenCount ?? u.output_tokens);
  const input = Math.max(0, prompt - cached);
  const output = Math.max(0, candidates - thoughts);
  const delta = {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: thoughts,
  };
  const total = computeTotalTokens(delta);
  if (total === 0) return null;
  return { ...delta, total_tokens: total };
}

function extractProject(cwd: unknown, filePath: string, baseDir: string): string {
  if (typeof cwd === 'string' && cwd.trim()) {
    return resolveProjectName(cwd);
  }
  const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
  if (filePath.startsWith(prefix)) {
    const relative = filePath.slice(prefix.length);
    const projectId = relative.split(sep)[0];
    if (projectId) return projectId;
  }
  const parent = basename(dirname(filePath));
  return parent === 'chats' ? 'unknown' : parent;
}

export interface ParseQwenResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseQwenIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseQwenResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as QwenExtCursors;
  if (!ext.qwen) {
    ext.qwen = { seenIds: [], files: {} };
  }
  if (!ext.qwen.files) ext.qwen.files = {};
  const seenIds = new Set(ext.qwen.seenIds ?? []);
  const fileCursors = ext.qwen.files;
  const bucketState: BucketAccumulator = new Map();
  const baseDir = qwenTmpDir();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of findQwenSessionFiles(baseDir)) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileCursors[filePath];
    if (
      prev &&
      prev.inode === st.ino &&
      prev.size === st.size &&
      prev.mtimeMs === st.mtimeMs
    ) {
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (obj.type !== 'assistant') continue;
      const usage = obj.usageMetadata;
      if (!usage || typeof usage !== 'object') continue;
      const usageRow = usage as Record<string, unknown>;
      if (usageRow.promptTokenCount == null && usageRow.candidatesTokenCount == null) continue;

      const uuid = typeof obj.uuid === 'string' ? obj.uuid : null;
      if (uuid) {
        if (seenIds.has(uuid)) continue;
      }

      const stamp = typeof obj.timestamp === 'string' ? obj.timestamp : null;
      if (!stamp) continue;

      const totals = normalizeUsageMetadata(usageRow);
      if (!totals) continue;

      const hourStart = toUtcHalfHourStart(stamp);
      if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

      const delta: TokenTotals = { ...totals, conversation_count: 1 };
      const model = typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : 'unknown';
      const project = extractProject(obj.cwd, filePath, baseDir);

      accumulateBucket(bucketState, 'qwen', model, project, hourStart, delta, QWEN_COLLECTOR);
      if (uuid) seenIds.add(uuid);
      eventsParsed += 1;
    }

    fileCursors[filePath] = { inode: st.ino, size: st.size, mtimeMs: st.mtimeMs };
    filesProcessed += 1;
  }

  ext.qwen.seenIds = Array.from(seenIds).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'qwen'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
