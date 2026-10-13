/**
 * Droid (Factory) passive reader (source `droid`, collector `droid`).
 *
 * Reads cumulative tokenUsage from `*.settings.json` under factory sessions dirs
 * and emits per-sync deltas keyed by session id.
 *
 * Path helpers to add in ../paths.ts:
 *   - droidSessionsDirs() — `$FACTORY_DIR/sessions`, `~/.factory/sessions`,
 *     and comma-separated `DROID_SESSIONS_DIR`
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';

export const DROID_COLLECTOR = 'droid';

type DroidSessionTotals = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  thinking: number;
  mtimeMs: number;
};

type DroidExtCursors = CursorsFile & {
  droid?: {
    sessionTotals?: Record<string, DroidSessionTotals>;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function droidSessionsDirs(): string[] {
  const explicit = process.env.DROID_SESSIONS_DIR?.trim();
  if (explicit) {
    return explicit
      .split(',')
      .map((d) => expandHome(d.trim()))
      .filter(Boolean);
  }
  const factory = process.env.FACTORY_DIR?.trim();
  if (factory) return [join(expandHome(factory), 'sessions')];
  return [join(homedir(), '.factory', 'sessions')];
}

function listDroidSettingsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.settings.json')) out.push(full);
    }
  };
  for (const dir of droidSessionsDirs()) {
    if (!existsSync(dir)) continue;
    walk(dir);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function droidSessionIdFromPath(filePath: string): string {
  const base = basename(filePath);
  if (!base.endsWith('.settings.json')) return '';
  return base.slice(0, -'.settings.json'.length);
}

function applyTotalFallback(usage: {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  thinking: number;
  totalTokens: number;
}): typeof usage {
  const known = usage.input + usage.output + usage.cacheCreation + usage.cacheRead + usage.thinking;
  const missing = usage.totalTokens > known ? usage.totalTokens - known : 0;
  if (missing === 0) return usage;
  if (usage.output === 0) return { ...usage, output: missing };
  return { ...usage, thinking: usage.thinking + missing };
}

function readFilledUsage(tokenUsage: Record<string, unknown>): {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  thinking: number;
} {
  const filled = applyTotalFallback({
    input: Math.max(0, Number(tokenUsage.inputTokens) || 0),
    output: Math.max(0, Number(tokenUsage.outputTokens) || 0),
    cacheCreation: Math.max(0, Number(tokenUsage.cacheCreationTokens) || 0),
    cacheRead: Math.max(0, Number(tokenUsage.cacheReadTokens) || 0),
    thinking: Math.max(0, Number(tokenUsage.thinkingTokens) || 0),
    totalTokens: Math.max(0, Number(tokenUsage.totalTokens) || 0),
  });
  return {
    input: filled.input,
    output: filled.output,
    cacheCreation: filled.cacheCreation,
    cacheRead: filled.cacheRead,
    thinking: filled.thinking,
  };
}

function tokenSum(t: Pick<DroidSessionTotals, 'input' | 'output' | 'cacheCreation' | 'cacheRead' | 'thinking'>): number {
  return t.input + t.output + t.cacheCreation + t.cacheRead + t.thinking;
}

function extractProjectFromSlug(slug: string): string {
  const parts = slug.split('-').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : 'unknown';
}

function dedupeDroidSettingsFiles(files: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const filePath of files) {
    const sessionId = droidSessionIdFromPath(filePath);
    if (!sessionId) continue;
    const group = groups.get(sessionId) ?? [];
    group.push(filePath);
    groups.set(sessionId, group);
  }

  const out: string[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    let best: string | null = null;
    let bestMetric = -1;
    let bestMtime = -1;
    for (const filePath of group) {
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        continue;
      }
      let settings: Record<string, unknown>;
      try {
        settings = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      } catch {
        continue;
      }
      const tokenUsage =
        settings.tokenUsage && typeof settings.tokenUsage === 'object'
          ? (settings.tokenUsage as Record<string, unknown>)
          : {};
      const filled = readFilledUsage(tokenUsage);
      const metric = tokenSum(filled);
      const better =
        metric > bestMetric ||
        (metric === bestMetric && mtimeMs > bestMtime) ||
        (metric === bestMetric && mtimeMs === bestMtime && (best === null || filePath.localeCompare(best) < 0));
      if (better) {
        best = filePath;
        bestMetric = metric;
        bestMtime = mtimeMs;
      }
    }
    out.push(best ?? group[0]!);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export interface ParseDroidResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseDroidIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseDroidResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as DroidExtCursors;
  if (!ext.droid) ext.droid = {};
  if (!ext.droid.sessionTotals) ext.droid.sessionTotals = {};
  const sessionTotals = ext.droid.sessionTotals;
  const bucketState: BucketAccumulator = new Map();

  let eventsParsed = 0;
  let filesProcessed = 0;
  const seenSessionIds = new Set<string>();

  for (const filePath of dedupeDroidSettingsFiles(listDroidSettingsFiles())) {
    const sessionId = droidSessionIdFromPath(filePath);
    if (!sessionId) continue;
    seenSessionIds.add(sessionId);

    let mtimeMs = 0;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      continue;
    }

    const prev: DroidSessionTotals = sessionTotals[sessionId] ?? {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
      thinking: 0,
      mtimeMs: 0,
    };
    if (mtimeMs && mtimeMs === prev.mtimeMs) continue;

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const tokenUsage =
      settings.tokenUsage && typeof settings.tokenUsage === 'object'
        ? (settings.tokenUsage as Record<string, unknown>)
        : null;
    if (!tokenUsage) continue;

    const now = readFilledUsage(tokenUsage);
    const sumNow = tokenSum(now);
    const sumPrev = tokenSum(prev);

    if (sumNow === 0) {
      if (sumPrev > 0) sessionTotals[sessionId] = { ...prev, mtimeMs };
      else sessionTotals[sessionId] = { ...now, mtimeMs };
      filesProcessed += 1;
      continue;
    }

    const isReset = sumNow < sumPrev;
    const dInput = isReset ? now.input : Math.max(0, now.input - prev.input);
    const dOutput = isReset ? now.output : Math.max(0, now.output - prev.output);
    const dCacheCreation = isReset ? now.cacheCreation : Math.max(0, now.cacheCreation - prev.cacheCreation);
    const dCacheRead = isReset ? now.cacheRead : Math.max(0, now.cacheRead - prev.cacheRead);
    const dThinking = isReset ? now.thinking : Math.max(0, now.thinking - prev.thinking);

    sessionTotals[sessionId] = { ...now, mtimeMs };

    if (dInput + dOutput + dCacheCreation + dCacheRead + dThinking === 0) {
      filesProcessed += 1;
      continue;
    }

    const hourStart = toUtcHalfHourStart(new Date(mtimeMs || Date.now()).toISOString());
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) {
      filesProcessed += 1;
      continue;
    }

    const deltaBody = {
      input_tokens: dInput,
      cached_input_tokens: dCacheRead,
      cache_creation_input_tokens: dCacheCreation,
      output_tokens: dOutput,
      reasoning_output_tokens: dThinking,
    };
    const delta: TokenTotals = {
      ...deltaBody,
      total_tokens: computeTotalTokens(deltaBody),
      conversation_count: 1,
    };

    const model =
      typeof settings.model === 'string' && settings.model.trim()
        ? settings.model.trim()
        : 'droid-unknown';
    const slug = basename(dirname(filePath));
    const project = extractProjectFromSlug(slug);

    accumulateBucket(bucketState, 'droid', model, project, hourStart, delta, DROID_COLLECTOR);
    eventsParsed += 1;
    filesProcessed += 1;
  }

  for (const id of Object.keys(sessionTotals)) {
    if (!seenSessionIds.has(id)) delete sessionTotals[id];
  }

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'droid'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
