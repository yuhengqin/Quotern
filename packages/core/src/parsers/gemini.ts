import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { geminiTmpDir } from '../paths.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';

export const GEMINI_COLLECTOR = 'gemini-cli';

type GeminiTotals = Omit<TokenTotals, 'conversation_count'>;

interface GeminiFileCursor {
  inode: number;
  size: number;
  mtimeMs: number;
  lastIndex: number;
  lastTotals: GeminiTotals | null;
  lastModel?: string;
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

/** TokensSummary fields are non-overlapping (TT semantics). */
export function normalizeGeminiTokens(tokens: Record<string, unknown> | null | undefined): GeminiTotals | null {
  if (!tokens || typeof tokens !== 'object') return null;
  const input = toNonNeg(tokens.input);
  const cached = toNonNeg(tokens.cached);
  const output = toNonNeg(tokens.output);
  const tool = toNonNeg(tokens.tool);
  const thoughts = toNonNeg(tokens.thoughts);
  const reportedTotal = toNonNeg(tokens.total);
  const computedTotal = input + cached + output + tool + thoughts;
  const total = Math.max(reportedTotal, computedTotal);
  if (total === 0 && input === 0 && output === 0 && cached === 0 && thoughts === 0) return null;
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: output + tool,
    reasoning_output_tokens: thoughts,
    total_tokens: total,
  };
}

function normalizeUsageMetadata(u: Record<string, unknown>): GeminiTotals | null {
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

export function sameGeminiTotals(a: GeminiTotals | null | undefined, b: GeminiTotals | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.input_tokens === b.input_tokens &&
    a.cached_input_tokens === b.cached_input_tokens &&
    a.cache_creation_input_tokens === b.cache_creation_input_tokens &&
    a.output_tokens === b.output_tokens &&
    a.reasoning_output_tokens === b.reasoning_output_tokens &&
    a.total_tokens === b.total_tokens
  );
}

function isAllZero(t: GeminiTotals): boolean {
  return (
    t.input_tokens === 0 &&
    t.cached_input_tokens === 0 &&
    t.cache_creation_input_tokens === 0 &&
    t.output_tokens === 0 &&
    t.reasoning_output_tokens === 0 &&
    t.total_tokens === 0
  );
}

/** Session-level cumulative snapshot diff. */
export function diffGeminiTotals(
  current: GeminiTotals,
  previous: GeminiTotals | null | undefined,
): GeminiTotals | null {
  if (!previous) return current;
  if (sameGeminiTotals(current, previous)) return null;
  if ((current.total_tokens || 0) < (previous.total_tokens || 0)) return current;

  const delta: GeminiTotals = {
    input_tokens: Math.max(0, current.input_tokens - previous.input_tokens),
    cached_input_tokens: Math.max(0, current.cached_input_tokens - previous.cached_input_tokens),
    cache_creation_input_tokens: Math.max(
      0,
      current.cache_creation_input_tokens - previous.cache_creation_input_tokens,
    ),
    output_tokens: Math.max(0, current.output_tokens - previous.output_tokens),
    reasoning_output_tokens: Math.max(
      0,
      current.reasoning_output_tokens - previous.reasoning_output_tokens,
    ),
    total_tokens: Math.max(0, current.total_tokens - previous.total_tokens),
  };
  return isAllZero(delta) ? null : delta;
}

function extractMessageTokens(msg: Record<string, unknown>): GeminiTotals | null {
  if (msg.tokens && typeof msg.tokens === 'object') {
    return normalizeGeminiTokens(msg.tokens as Record<string, unknown>);
  }
  const u = (msg.usageMetadata ?? msg.usage) as Record<string, unknown> | undefined;
  if (u && typeof u === 'object') return normalizeUsageMetadata(u);
  return null;
}

function classifyRole(msg: Record<string, unknown>): 'user' | 'assistant' | null {
  const t = msg.type ?? msg.role;
  if (t === 'user') return 'user';
  if (t === 'gemini' || t === 'model' || t === 'assistant') return 'assistant';
  return null;
}

function projectFromDirectories(directories: unknown): string {
  if (!Array.isArray(directories) || directories.length === 0) return 'unknown';
  const first = directories[0];
  if (!first) return 'unknown';
  return resolveProjectName(String(first));
}

function collectChatFiles(dir: string, out: string[], depth: number): void {
  if (depth > 2) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectChatFiles(full, out, depth + 1);
    } else if (e.name.endsWith('.jsonl') || e.name.endsWith('.json')) {
      out.push(full);
    }
  }
}

export function findGeminiSessionFiles(baseDir = geminiTmpDir()): string[] {
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
    collectChatFiles(join(baseDir, entry.name, 'chats'), results, 0);
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function readRecords(filePath: string): {
  messages: Record<string, unknown>[];
  directories: string[] | null;
} | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (filePath.endsWith('.jsonl')) {
    const messages: Record<string, unknown>[] = [];
    let directories: string[] | null = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!directories && Array.isArray(obj.directories)) {
        directories = obj.directories as string[];
      }
      if (typeof obj.type === 'string' || typeof obj.role === 'string') {
        messages.push(obj);
      }
    }
    return { messages, directories };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const messages = (data.messages || data.history || []) as Record<string, unknown>[];
  return {
    messages: Array.isArray(messages) ? messages : [],
    directories: Array.isArray(data.directories) ? (data.directories as string[]) : null,
  };
}

export interface ParseGeminiResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseGeminiIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseGeminiResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.gemini) {
    cursors.gemini = { files: {} };
  }
  const fileCursors = cursors.gemini.files;
  const bucketState: BucketAccumulator = new Map();
  const files = findGeminiSessionFiles();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of files) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileCursors[filePath] as GeminiFileCursor | undefined;
    const unchanged =
      prev &&
      prev.inode === st.ino &&
      prev.size === st.size &&
      prev.mtimeMs === st.mtimeMs;
    if (unchanged) continue;

    const record = readRecords(filePath);
    if (!record) continue;

    const project = projectFromDirectories(record.directories);
    const begin = prev && prev.inode === st.ino ? (prev.lastIndex ?? -1) + 1 : 0;
    let totals: GeminiTotals | null =
      prev && prev.inode === st.ino ? (prev.lastTotals ?? null) : null;
    let lastModel = prev?.lastModel ?? 'unknown';

    const messages = record.messages;
    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx]!;
      const role = classifyRole(msg);
      if (role !== 'assistant') continue;

      const currentTotals = extractMessageTokens(msg);
      if (idx < begin) {
        if (currentTotals) totals = currentTotals;
        if (typeof msg.model === 'string' && msg.model) lastModel = msg.model;
        continue;
      }

      if (typeof msg.model === 'string' && msg.model) lastModel = msg.model;

      const stamp = (msg.timestamp ?? msg.createTime) as string | undefined;
      if (!stamp || !currentTotals) {
        if (currentTotals) totals = currentTotals;
        continue;
      }

      const hourStart = toUtcHalfHourStart(stamp);
      if (!hourStart) {
        totals = currentTotals;
        continue;
      }
      if (new Date(hourStart).getTime() < sinceMs) {
        totals = currentTotals;
        continue;
      }

      const delta = diffGeminiTotals(currentTotals, totals);
      totals = currentTotals;
      if (!delta) continue;

      const tokenDelta: TokenTotals = { ...delta, conversation_count: 1 };
      accumulateBucket(
        bucketState,
        'gemini',
        lastModel || 'unknown',
        project,
        hourStart,
        tokenDelta,
        GEMINI_COLLECTOR,
      );
      eventsParsed += 1;
    }

    fileCursors[filePath] = {
      inode: st.ino,
      size: st.size,
      mtimeMs: st.mtimeMs,
      lastIndex: messages.length - 1,
      lastTotals: totals,
      lastModel,
    };
    filesProcessed += 1;
  }

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'gemini'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
