/**
 * Codex thread ledger — source `codex`, collector `codex-ledger`.
 *
 * `state_<n>.sqlite` `threads.tokens_used` is the lifetime total for a thread.
 * Rollout JSONL remains the detail source (half-hour, input/output/cache).
 * This module only adds the part of that total the JSONL scan never saw:
 * a rollout deleted before we recorded it, or a tail that is in the ledger
 * but not in the file. Tokens the file already showed — including events
 * skipped for `statsSince` or fork replay — are not a gap.
 *
 * The ledger has no input/output/cache split, so a gap is `input_tokens`,
 * same as `warp.ts`. It lands in the half-hour of `recency_at_ms` (or
 * `created_at_ms`) under collector `codex-ledger`.
 */
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { TokenTotals } from '../types.js';
import { codexHomeCandidates } from '../paths.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import { UNKNOWN_MODEL } from '../queue/align-unknown.js';
import { accumulateBucket, computeTotalTokens, type BucketAccumulator } from './shared.js';
import { queryDbJson, readSqliteWithSnapshot, sqliteTableExists } from './sqlite.js';

export const CODEX_LEDGER_COLLECTOR = 'codex-ledger';

/** Codex names its ledger `state_<schema-version>.sqlite`. */
const LEDGER_FILE_NAME = /^state(?:_(\d+))?\.sqlite$/;

const THREADS_TABLE = 'threads';

/**
 * Columns the reader needs, with the literal to project when a Codex version
 * does not have them yet. The projection stays explicit so preview text
 * columns are not pulled into memory.
 */
const LEDGER_COLUMNS: ReadonlyArray<readonly [column: string, missing: string]> = [
  ['id', `''`],
  ['rollout_path', `''`],
  ['tokens_used', '0'],
  ['model', `''`],
  ['cwd', `''`],
  ['recency_at_ms', '0'],
  ['created_at_ms', '0'],
];

export interface CodexLedgerThread {
  id: string;
  /** Absolute rollout path when the thread was written; `''` when unknown. */
  rolloutPath: string;
  /** Thread lifetime total, matching the rollout's final `total_token_usage`. */
  tokensUsed: number;
  model: string;
  cwd: string;
  /** Last activity, falling back to creation; `0` when the ledger has neither. */
  timestampMs: number;
}

/** What one rollout scan explained this round. Absent when the file was not read. */
export interface CodexRolloutScan {
  /** Tokens newly written to precise buckets. Watermark grows by this, not by lifetime. */
  emitted: number;
  /**
   * Highest `total_token_usage.total_tokens` seen this round.
   * `null` when the file had no cumulative field (use `observed` instead).
   */
  lifetime: number | null;
  /** Parsed deltas this round, including `statsSince` skips and fork replay. */
  observed: number;
  sessionId: string | null;
}

/** Ledger databases under every Codex home (may not exist). */
export function codexLedgerDbPaths(): string[] {
  const paths: string[] = [];
  for (const home of codexHomeCandidates()) {
    let entries: string[];
    try {
      entries = readdirSync(home);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      if (!LEDGER_FILE_NAME.test(name)) continue;
      const dbPath = join(home, name);
      if (!paths.includes(dbPath)) paths.push(dbPath);
    }
  }
  return paths;
}

/** `state.sqlite` is version 0; `state_<n>.sqlite` is n. Unmatched names are -1. */
export function codexLedgerSchemaVersion(dbPath: string): number {
  const match = LEDGER_FILE_NAME.exec(basename(dbPath));
  if (!match) return -1;
  return match[1] ? Number(match[1]) : 0;
}

/** One ledger per home: the highest schema version. Older files are ignored. */
export function newestCodexLedgerPaths(dbPaths: readonly string[]): string[] {
  const byDir = new Map<string, string>();
  for (const dbPath of dbPaths) {
    const dir = dirname(dbPath);
    const prev = byDir.get(dir);
    if (!prev || codexLedgerSchemaVersion(dbPath) > codexLedgerSchemaVersion(prev)) {
      byDir.set(dir, dbPath);
    }
  }
  return [...byDir.values()];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Read `threads` from a Codex ledger.
 *
 * A missing table yields no rows. Columns are probed first because the table
 * gained `model` / `cwd` / `*_ms` over time.
 */
export function readCodexLedgerThreads(dbPath: string): CodexLedgerThread[] {
  if (!sqliteTableExists(dbPath, THREADS_TABLE)) return [];

  const present = new Set(
    queryDbJson(dbPath, `SELECT name FROM pragma_table_info('${THREADS_TABLE}')`).map((row) =>
      asText(row.name),
    ),
  );
  const projection = LEDGER_COLUMNS.map(([column, missing]) =>
    present.has(column) ? column : `${missing} AS ${column}`,
  ).join(', ');

  const rows = queryDbJson(dbPath, `SELECT ${projection} FROM ${THREADS_TABLE}`, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });

  const threads: CodexLedgerThread[] = [];
  for (const row of rows) {
    const id = asText(row.id);
    if (!id) continue;
    const recency = asCount(row.recency_at_ms);
    threads.push({
      id,
      rolloutPath: asText(row.rollout_path),
      tokensUsed: asCount(row.tokens_used),
      model: asText(row.model),
      cwd: asText(row.cwd),
      timestampMs: recency > 0 ? recency : asCount(row.created_at_ms),
    });
  }
  return threads;
}

export interface LoadCodexLedgerOptions {
  dbMtimes: Record<string, number>;
  /** Read even when mtime is unchanged. Used when new JSONL cannot be matched yet. */
  force?: boolean;
}

export interface LoadCodexLedgerResult {
  threads: CodexLedgerThread[];
  filesProcessed: number;
  /** Newest ledgers left unread because their mtime matched the cursor. */
  skippedDbPaths: string[];
  error?: string;
}

/** Read the newest ledger in each Codex home. Unchanged files are skipped unless `force`. */
export function loadCodexLedgerThreads(opts: LoadCodexLedgerOptions): LoadCodexLedgerResult {
  const dbPaths = newestCodexLedgerPaths(codexLedgerDbPaths());
  if (dbPaths.length === 0) return { threads: [], filesProcessed: 0, skippedDbPaths: [] };

  const threads: CodexLedgerThread[] = [];
  const skippedDbPaths: string[] = [];
  let filesProcessed = 0;

  try {
    for (const dbPath of dbPaths) {
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(dbPath).mtimeMs;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
        throw err;
      }
      if (!opts.force && mtimeMs > 0 && mtimeMs === opts.dbMtimes[dbPath]) {
        skippedDbPaths.push(dbPath);
        continue;
      }

      const rows = readSqliteWithSnapshot(dbPath, readCodexLedgerThreads);
      filesProcessed += 1;
      threads.push(...rows);
      opts.dbMtimes[dbPath] = mtimeMs;
    }
  } catch (err) {
    return {
      threads,
      filesProcessed,
      skippedDbPaths,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { threads, filesProcessed, skippedDbPaths };
}

export interface ReconcileCodexLedgerOptions {
  ledgerTotals: Record<string, { tokens: number }>;
  jsonlEmitted: number;
  jsonlLifetime: number | null;
  jsonlObserved: number;
  /**
   * Rollout basename was already in `cursors.codex.files` before this round.
   * Combined with a missing watermark, that seeds once and does not emit.
   */
  alreadyCounted: boolean;
  sinceMs: number;
  bucketState: BucketAccumulator;
}

function emptyScan(): CodexRolloutScan {
  return { emitted: 0, lifetime: null, observed: 0, sessionId: null };
}

function scanForThread(
  thread: CodexLedgerThread,
  scans: ReadonlyMap<string, CodexRolloutScan>,
): CodexRolloutScan {
  if (thread.rolloutPath) {
    const byPath = scans.get(basename(thread.rolloutPath));
    if (byPath) return byPath;
  }
  if (thread.id) {
    for (const scan of scans.values()) {
      if (scan.sessionId === thread.id) return scan;
    }
  }
  return emptyScan();
}

/**
 * Apply the ledger authority formula for one thread.
 *
 * The watermark is the lifetime already reported, not the last `tokens_used`.
 * It rises with this round's precise-bucket tokens and with the file lifetime
 * when that is higher, so a later ledger catch-up does not re-bill JSONL.
 * It does not add the file lifetime on top of the previous watermark.
 */
export function reconcileCodexLedgerThread(
  thread: CodexLedgerThread,
  opts: ReconcileCodexLedgerOptions,
): boolean {
  const seen = Object.prototype.hasOwnProperty.call(opts.ledgerTotals, thread.id);
  const previous = opts.ledgerTotals[thread.id]?.tokens ?? 0;
  const lifetimeFloor = opts.jsonlLifetime ?? 0;

  // Upgrade: this rollout was counted before ledger watermarks existed.
  // Seed and stay silent so the historical total is not reported again.
  if (opts.alreadyCounted && !seen) {
    opts.ledgerTotals[thread.id] = {
      tokens: Math.max(thread.tokensUsed, lifetimeFloor, opts.jsonlEmitted),
    };
    return false;
  }

  const isReset = thread.tokensUsed > 0 && thread.tokensUsed < previous;
  const budget = isReset ? thread.tokensUsed : Math.max(0, thread.tokensUsed - previous);
  let gap: number;
  if (isReset) {
    const explained = opts.jsonlLifetime ?? opts.jsonlObserved;
    gap = Math.max(0, thread.tokensUsed - explained);
  } else if (opts.jsonlLifetime != null) {
    const explained = Math.max(previous, opts.jsonlLifetime);
    const unseen = Math.max(0, thread.tokensUsed - explained);
    gap = Math.min(budget, unseen);
  } else {
    const unseen = Math.max(0, thread.tokensUsed - previous);
    gap = Math.max(0, Math.min(budget, unseen) - opts.jsonlObserved);
  }

  // Floor at the file lifetime, but do not add it to `previous`.
  const nextWatermark = isReset
    ? Math.max(thread.tokensUsed, lifetimeFloor, opts.jsonlEmitted)
    : Math.max(thread.tokensUsed, previous + opts.jsonlEmitted, lifetimeFloor);

  let wrote = false;
  if (gap > 0 && thread.timestampMs > 0) {
    const hourStart = toUtcHalfHourStart(new Date(thread.timestampMs).toISOString());
    if (hourStart && new Date(hourStart).getTime() >= opts.sinceMs) {
      const body = {
        input_tokens: gap,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
      };
      const totals: TokenTotals = {
        ...body,
        total_tokens: computeTotalTokens(body),
        conversation_count: previous === 0 || isReset ? 1 : 0,
      };
      accumulateBucket(
        opts.bucketState,
        'codex',
        thread.model || UNKNOWN_MODEL,
        thread.cwd ? resolveProjectName(thread.cwd) : UNKNOWN_MODEL,
        hourStart,
        totals,
        CODEX_LEDGER_COLLECTOR,
      );
      wrote = true;
    }
  }

  opts.ledgerTotals[thread.id] = { tokens: nextWatermark };
  return wrote;
}

export interface ApplyCodexLedgerOptions {
  dbMtimes: Record<string, number>;
  ledgerTotals: Record<string, { tokens: number }>;
  /** Rollout basenames present in the file cursor before this round. */
  priorRolloutNames: ReadonlySet<string>;
  /** Keyed by rollout basename. */
  scans: ReadonlyMap<string, CodexRolloutScan>;
  sinceMs: number;
  bucketState: BucketAccumulator;
}

export interface ApplyCodexLedgerResult {
  eventsParsed: number;
  filesProcessed: number;
  error?: string;
}

/**
 * Load the ledger and reconcile every thread.
 *
 * An unread database (mtime unchanged) still advances watermarks for JSONL
 * emitted this round when the session id is already a watermark key. Otherwise
 * the next read would treat that JSONL as a ledger gap.
 */
export function applyCodexLedger(opts: ApplyCodexLedgerOptions): ApplyCodexLedgerResult {
  const needsRead = [...opts.scans.values()].some(
    (scan) => scan.emitted > 0 && (!scan.sessionId || opts.ledgerTotals[scan.sessionId] == null),
  );
  const loaded = loadCodexLedgerThreads({
    dbMtimes: opts.dbMtimes,
    force: needsRead,
  });

  let eventsParsed = 0;
  const reconciled = new Set<string>();
  if (!loaded.error) {
    for (const thread of loaded.threads) {
      const scan = scanForThread(thread, opts.scans);
      const rolloutName = thread.rolloutPath ? basename(thread.rolloutPath) : '';
      if (
        reconcileCodexLedgerThread(thread, {
          ledgerTotals: opts.ledgerTotals,
          jsonlEmitted: scan.emitted,
          jsonlLifetime: scan.lifetime,
          jsonlObserved: scan.observed,
          alreadyCounted: rolloutName !== '' && opts.priorRolloutNames.has(rolloutName),
          sinceMs: opts.sinceMs,
          bucketState: opts.bucketState,
        })
      ) {
        eventsParsed += 1;
      }
      reconciled.add(thread.id);
    }
  }

  if (loaded.skippedDbPaths.length > 0 || loaded.error) {
    for (const scan of opts.scans.values()) {
      if (!scan.sessionId || scan.emitted <= 0) continue;
      if (reconciled.has(scan.sessionId)) continue;
      const row = opts.ledgerTotals[scan.sessionId];
      if (!row) continue;
      row.tokens = Math.max(row.tokens + scan.emitted, scan.lifetime ?? 0);
    }
  }

  return {
    eventsParsed,
    filesProcessed: loaded.filesProcessed,
    ...(loaded.error ? { error: loaded.error } : {}),
  };
}
