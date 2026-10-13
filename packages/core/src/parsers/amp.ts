/**
 * Amp passive reader (source `amp`, collector `amp`).
 *
 * Thread files under AMP_DATA_DIR (or XDG default): recursive T-*.json.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';

export const AMP_COLLECTOR = 'amp';

type AmpExtCursors = CursorsFile & {
  amp?: {
    seenIds?: string[];
    fileOffsets?: Record<string, { size: number; mtimeMs: number; ino: number }>;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function resolveAmpThreadsDir(): string {
  const env = process.env.AMP_DATA_DIR?.trim();
  if (env) return expandHome(env);
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return join(expandHome(xdg), 'amp', 'threads');
  return join(homedir(), '.local', 'share', 'amp', 'threads');
}

export function findAmpThreadFiles(dir = resolveAmpThreadsDir()): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAmpThreadFiles(fullPath));
    } else if (entry.isFile() && entry.name.startsWith('T-') && entry.name.endsWith('.json')) {
      results.push(fullPath);
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

function coerceTimestamp(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export interface ParseAmpResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseAmpIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseAmpResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as AmpExtCursors;
  if (!ext.amp) {
    ext.amp = { seenIds: [], fileOffsets: {} };
  }
  if (!ext.amp.fileOffsets) ext.amp.fileOffsets = {};
  const seenIds = new Set(ext.amp.seenIds ?? []);
  const fileOffsets = ext.amp.fileOffsets;
  const bucketState: BucketAccumulator = new Map();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of findAmpThreadFiles()) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileOffsets[filePath];
    if (
      prev &&
      prev.size === st.size &&
      prev.mtimeMs === st.mtimeMs &&
      prev.ino === st.ino
    ) {
      continue;
    }

    let thread: Record<string, unknown>;
    try {
      thread = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }

    const threadId = typeof thread.id === 'string' && thread.id ? thread.id : filePath;
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const ledgerEvents = Array.isArray((thread.usageLedger as { events?: unknown })?.events)
      ? ((thread.usageLedger as { events: unknown[] }).events)
      : [];
    const hasLedger = ledgerEvents.length > 0;

    if (hasLedger) {
      for (let index = 0; index < ledgerEvents.length; index++) {
        const event = ledgerEvents[index];
        if (!event || typeof event !== 'object') continue;
        const row = event as {
          timestamp?: unknown;
          tokens?: { input?: unknown; output?: unknown };
          model?: unknown;
          toMessageId?: unknown;
        };

        const dedupKey = `${threadId}|ledger|${index}`;
        if (seenIds.has(dedupKey)) continue;

        const stamp = coerceTimestamp(row.timestamp);
        if (!stamp) continue;

        const inputTokens = toNonNeg(row.tokens?.input);
        const outputTokens = toNonNeg(row.tokens?.output);
        if (inputTokens === 0 && outputTokens === 0) continue;

        const toMessageId = row.toMessageId;
        const toMessage =
          typeof toMessageId === 'number' && Number.isInteger(toMessageId)
            ? (messages[toMessageId] as { usage?: { cacheReadInputTokens?: unknown } } | undefined)
            : undefined;
        const cacheRead = toNonNeg(toMessage?.usage?.cacheReadInputTokens);

        const hourStart = toUtcHalfHourStart(stamp);
        if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

        const deltaBody = {
          input_tokens: inputTokens,
          cached_input_tokens: cacheRead,
          cache_creation_input_tokens: 0,
          output_tokens: outputTokens,
          reasoning_output_tokens: 0,
        };
        const total = computeTotalTokens(deltaBody);
        const delta: TokenTotals = { ...deltaBody, total_tokens: total, conversation_count: 1 };

        const model =
          typeof row.model === 'string' && row.model.trim() ? row.model.trim() : 'unknown';
        accumulateBucket(bucketState, 'amp', model, 'unknown', hourStart, delta, AMP_COLLECTOR);
        seenIds.add(dedupKey);
        eventsParsed += 1;
      }
    } else {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (!message || typeof message !== 'object') continue;
        const row = message as {
          usage?: {
            inputTokens?: unknown;
            outputTokens?: unknown;
            cacheReadInputTokens?: unknown;
            model?: unknown;
          };
          timestamp?: unknown;
        };
        const usage = row.usage;
        if (!usage) continue;

        const dedupKey = `${threadId}|msg|${index}`;
        if (seenIds.has(dedupKey)) continue;

        const stamp = coerceTimestamp(row.timestamp ?? thread.created);
        if (!stamp) continue;

        const inputTokens = toNonNeg(usage.inputTokens);
        const outputTokens = toNonNeg(usage.outputTokens);
        const cacheRead = toNonNeg(usage.cacheReadInputTokens);
        if (inputTokens === 0 && outputTokens === 0 && cacheRead === 0) continue;

        const hourStart = toUtcHalfHourStart(stamp);
        if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

        const deltaBody = {
          input_tokens: inputTokens,
          cached_input_tokens: cacheRead,
          cache_creation_input_tokens: 0,
          output_tokens: outputTokens,
          reasoning_output_tokens: 0,
        };
        const total = computeTotalTokens(deltaBody);
        const delta: TokenTotals = { ...deltaBody, total_tokens: total, conversation_count: 1 };

        const model =
          typeof usage.model === 'string' && usage.model.trim() ? usage.model.trim() : 'unknown';
        accumulateBucket(bucketState, 'amp', model, 'unknown', hourStart, delta, AMP_COLLECTOR);
        seenIds.add(dedupKey);
        eventsParsed += 1;
      }
    }

    fileOffsets[filePath] = { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
    filesProcessed += 1;
  }

  ext.amp.seenIds = Array.from(seenIds).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'amp'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
