import { randomUUID } from 'node:crypto';
import { mkdtemp, open, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueueBucket } from './types.js';
import { parseClaudeIncremental } from './parsers/claude.js';
import { TOKEN_FIELDS, type RequestPricingFact } from './pricing/request-pricing.js';
import { bucketKey, toUtcHalfHourStart } from './queue/keys.js';
import { localDateAndHour } from './timezone.js';
import { localEvidence, mergeLocalEvidence } from './local-metrics.js';

export const RECOVERY_FILE = 'usage-recovery.json';
export const RECOVERY_INPUT_BYTES = 8 * 1024 * 1024;
export const RECOVERY_REQUEST_BYTES = 20 * 1024 * 1024;
export const RECOVERY_FILE_LIMIT = 20;
const RECORD_LIMIT = 50_000;
const DOC_LIMIT = 32 * 1024 * 1024;
const minimum = '0001-01-01T00:00:00.000Z';

export interface RecoveryPreview {
  id: string | null;
  tokens: number;
  requests: number;
  duplicate: number;
  uncertain: number;
  skippedFiles: number;
  days: { date: string; tokens: number }[];
  dayCount: number;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sumTokens = (value: Pick<QueueBucket, typeof TOKEN_FIELDS[number]>) => TOKEN_FIELDS.reduce((sum, key) => sum + value[key], 0);
const identity = (row: QueueBucket, fact: RequestPricingFact) => `${row.source}:${fact.id}`;
const dayKey = (row: QueueBucket) => `${row.source}:${row.hour_start.slice(0, 10)}`;
const goodLabel = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f|]/.test(value);
const goodFact = (value: unknown): value is RequestPricingFact => record(value)
  && Object.keys(value).every(key => ['id', 'timestamp', 'requestInputTokens', 'serviceTier', 'cacheWrite5mTokens', 'cacheWrite1hTokens', ...TOKEN_FIELDS].includes(key))
  && typeof value.id === 'string' && /^[a-f0-9]{64}$/.test(value.id)
  && typeof value.timestamp === 'string' && value.timestamp.length <= 40 && Number.isFinite(Date.parse(value.timestamp))
  && TOKEN_FIELDS.every(key => safeCount(value[key]))
  && ['requestInputTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens'].every(key => value[key] === undefined || safeCount(value[key]))
  && (value.serviceTier === undefined || ['standard', 'fast', 'flex', 'unknown'].includes(String(value.serviceTier)));

function rowForFact(row: QueueBucket, fact: RequestPricingFact): QueueBucket {
  const parts = { input_tokens: fact.input_tokens, output_tokens: fact.output_tokens, cached_input_tokens: fact.cached_input_tokens,
    cache_creation_input_tokens: fact.cache_creation_input_tokens, reasoning_output_tokens: fact.reasoning_output_tokens };
  return { hour_start: row.hour_start, source: row.source, model: row.model, project: row.project, ...(row.collector ? { collector: row.collector } : {}),
    ...parts, total_tokens: sumTokens(parts), conversation_count: 1, token_quality: 'recorded', pricing_requests: [fact] };
}

export function validateRecoveryDocument(value: unknown): QueueBucket[] {
  if (!record(value) || value.version !== 1 || Object.keys(value).length !== 2 || !Array.isArray(value.rows) || value.rows.length > RECORD_LIMIT) throw new Error('RECOVERY_INVALID_STORE');
  const seen = new Set<string>();
  return value.rows.map((raw: unknown) => {
    if (!record(raw) || raw.source !== 'claude' || !goodLabel(raw.model) || !goodLabel(raw.project)
      || (raw.collector !== undefined && !goodLabel(raw.collector)) || typeof raw.hour_start !== 'string'
      || !Array.isArray(raw.pricing_requests) || raw.pricing_requests.length !== 1 || !goodFact(raw.pricing_requests[0])) throw new Error('RECOVERY_INVALID_STORE');
    const row = raw as unknown as QueueBucket;
    const fact = row.pricing_requests![0]!;
    const normalized = rowForFact(row, fact);
    const id = identity(row, fact);
    if (row.hour_start !== toUtcHalfHourStart(fact.timestamp) || !safeCount(normalized.total_tokens) || !normalized.total_tokens || seen.has(id)
      || Object.keys(raw).some(key => !Object.hasOwn(normalized, key)) || row.total_tokens !== normalized.total_tokens
      || row.conversation_count !== 1 || row.token_quality !== 'recorded' || TOKEN_FIELDS.some(key => row[key] !== normalized[key])) throw new Error('RECOVERY_INVALID_STORE');
    seen.add(id);
    return normalized;
  });
}

export async function readRecoveryRows(dir: string): Promise<QueueBucket[]> {
  let file;
  try { file = await open(join(dir, RECOVERY_FILE), 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  try {
    if ((await file.stat()).size > DOC_LIMIT) throw new Error('RECOVERY_INVALID_STORE');
    return validateRecoveryDocument(JSON.parse(await file.readFile('utf8')));
  } finally { await file.close(); }
}

export async function saveRecoveryRows(dir: string, rows: QueueBucket[]): Promise<void> {
  if (rows.length > RECORD_LIMIT) throw new Error('RECOVERY_STORE_FULL');
  const data = { version: 1, rows };
  validateRecoveryDocument(data);
  const json = JSON.stringify(data) + '\n';
  if (Buffer.byteLength(json) > DOC_LIMIT) throw new Error('RECOVERY_STORE_FULL');
  const path = join(dir, RECOVERY_FILE), temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    try { await file.writeFile(json); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => undefined); }
}

/** Read only the files chosen for this preview. Never touch the live parser's cursors or ledger. */
export async function scanRecoveryFiles(input: unknown, now = Date.now()): Promise<{ rows: QueueBucket[]; uncertain: number; skippedFiles: number }> {
  if (!Array.isArray(input) || !input.length || input.length > RECOVERY_FILE_LIMIT || !input.every(file => typeof file === 'string')) throw new Error('RECOVERY_INVALID');
  if (input.reduce((size, file) => size + Buffer.byteLength(file), 0) > RECOVERY_INPUT_BYTES) throw new Error('RECOVERY_TOO_LARGE');
  const dir = await mkdtemp(join(tmpdir(), 'quotern-recovery-'));
  try {
    const claude: string[] = [];
    let skippedFiles = 0;
    for (const [index, content] of (input as string[]).entries()) {
      const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
      const usageLines: string[] = [];
      let cwd: string | undefined, invalid = false;
      for (const line of lines) {
        let event: unknown;
        try { event = JSON.parse(line); } catch { invalid = true; continue; }
        if (!record(event)) { invalid = true; continue; }
        if (!cwd && typeof event.cwd === 'string' && event.cwd.length <= 4096 && !event.cwd.includes('\0')) cwd = event.cwd;
        if (event.type === 'assistant' && record(event.message) && record(event.message.usage)) {
          const id = event.message.id, raw = event.message.usage;
          if (id !== undefined && (typeof id !== 'string' || id.length > 512 || id in Object.prototype)
            || event.requestId !== undefined && event.requestId !== null && (typeof event.requestId !== 'string' || event.requestId.length > 512)) { invalid = true; continue; }
          const usage = Object.fromEntries(['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].filter(key => safeCount(raw[key])).map(key => [key, raw[key]]));
          usage.speed = typeof raw.speed === 'string' && ['standard', 'fast', 'priority', 'flex'].includes(raw.speed) ? raw.speed : undefined;
          const cacheCreation = record(raw.cache_creation) ? raw.cache_creation : null;
          if (cacheCreation) usage.cache_creation = Object.fromEntries(['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'].filter(key => safeCount(cacheCreation[key])).map(key => [key, cacheCreation[key]]));
          usageLines.push(JSON.stringify({ type: 'assistant', timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined, requestId: event.requestId,
            message: { id, model: goodLabel(event.message.model) ? event.message.model : undefined, usage } }));
        }
      }
      if (invalid || !usageLines.length) { skippedFiles++; continue; }
      const path = join(dir, `${index}.jsonl`);
      // Keep prompt, response and tool contents out of temporary parser inputs too.
      await writeFile(path, [JSON.stringify({ cwd }), ...usageLines, ''].join('\n'), { mode: 0o600, flag: 'wx' });
      claude.push(path);
    }
    const parsed = await parseClaudeIncremental({}, minimum, claude);
    const rows: QueueBucket[] = [];
    let uncertain = 0;
    for (const row of parsed.result.buckets) {
      const facts = row.pricing_requests ?? [];
      if (!goodLabel(row.model) || row.model === 'unknown' || !goodLabel(row.project) || (row.collector && !goodLabel(row.collector))) {
        uncertain += Math.max(1, facts.length); continue;
      }
      let accounted = 0;
      for (const fact of facts) {
        if (!goodFact(fact) || row.hour_start !== toUtcHalfHourStart(fact.timestamp) || Date.parse(fact.timestamp) > now) { uncertain++; continue; }
        const recovered = rowForFact(row, fact);
        if (!safeCount(recovered.total_tokens) || !recovered.total_tokens) { uncertain++; continue; }
        accounted += recovered.total_tokens;
        rows.push(recovered);
        if (rows.length > RECORD_LIMIT) throw new Error('RECOVERY_TOO_LARGE');
      }
      if (!facts.length || accounted < row.total_tokens && accounted === facts.reduce((total, fact) => total + sumTokens(fact), 0)) uncertain += Math.max(1, row.conversation_count - facts.length);
    }
    return { rows, uncertain, skippedFiles };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Identity comparison covers all projects and both collector variants. Legacy amounts without
 * request evidence may already include the selected records. */
export function selectRecoveryRows(base: Iterable<QueueBucket>, candidates: readonly QueueBucket[], already: readonly QueueBucket[] = []) {
  const known = new Set(already.map(row => identity(row, row.pricing_requests![0]!)));
  const uncertainDays = new Set<string>();
  for (const row of base) {
    if (row.source !== 'claude') continue;
    const byId = new Map<string, RequestPricingFact>();
    for (const fact of row.pricing_requests ?? []) if (goodFact(fact)) byId.set(fact.id, fact);
    for (const fact of byId.values()) known.add(identity(row, fact));
    const facts = [...byId.values()];
    if (TOKEN_FIELDS.some(key => facts.reduce((sum, fact) => sum + fact[key], 0) !== (row[key] ?? 0)) || facts.length < row.conversation_count) {
      uncertainDays.add(dayKey(row));
    }
  }
  const rows: QueueBucket[] = [];
  let duplicate = 0, uncertain = 0;
  for (const row of candidates) {
    const id = identity(row, row.pricing_requests![0]!);
    if (known.has(id)) { duplicate++; continue; }
    // Claude streaming can cross midnight before a later surviving snapshot.
    const at = Date.parse(row.hour_start);
    if ([-86400000, 0, 86400000].some(offset => uncertainDays.has(`${row.source}:${new Date(at + offset).toISOString().slice(0, 10)}`))) { uncertain++; continue; }
    known.add(id);
    rows.push(row);
  }
  return { rows, duplicate, uncertain };
}

/** Reconcile only actual request identities after import. An unrelated later
 * collection without IDs must not erase accepted historical usage. */
export function activeRecoveryRows(base: Iterable<QueueBucket>, recovered: readonly QueueBucket[]): QueueBucket[] {
  if (!recovered.length) return [];
  const pending = new Map(recovered.map(row => [identity(row, row.pricing_requests![0]!), row]));
  for (const row of base) {
    if (row.source !== 'claude') continue;
    for (const fact of row.pricing_requests ?? []) pending.delete(identity(row, fact));
    if (!pending.size) break;
  }
  return [...pending.values()];
}

export function mergeRecoveryRows(base: readonly QueueBucket[], active: readonly QueueBucket[]): QueueBucket[] {
  if (!active.length) return [...base];
  const rows = new Map(base.map(row => [bucketKey(row), row]));
  for (const entry of active) {
    const key = bucketKey(entry), previous = rows.get(key);
    const evidence = localEvidence(1, true, false, false);
    if (!previous) { rows.set(key, { ...entry, local_metrics: evidence }); continue; }
    const row = { ...previous, total_tokens: previous.total_tokens + entry.total_tokens, conversation_count: previous.conversation_count + 1,
      pricing_requests: [...(previous.pricing_requests ?? []), ...entry.pricing_requests!],
      local_metrics: mergeLocalEvidence(previous.local_metrics ?? localEvidence(previous.conversation_count, false, false, false), evidence) };
    for (const field of TOKEN_FIELDS) row[field] = (previous[field] ?? 0) + entry[field];
    rows.set(key, row);
  }
  return [...rows.values()];
}

export function recoveryFloor(collectSince: string, rows: readonly QueueBucket[]): string {
  return rows.reduce((floor, row) => Date.parse(row.hour_start) < Date.parse(floor) ? row.hour_start : floor, collectSince);
}

export function summarizeRecovery(rows: readonly QueueBucket[], duplicate: number, uncertain: number, skippedFiles: number): RecoveryPreview {
  const dates = new Map<string, number>();
  let tokens = 0;
  for (const row of rows) {
    const { date } = localDateAndHour(row.hour_start);
    dates.set(date, (dates.get(date) ?? 0) + row.total_tokens);
    tokens += row.total_tokens;
  }
  return { id: null, tokens, requests: rows.length, duplicate, uncertain, skippedFiles, dayCount: dates.size,
    days: [...dates].sort(([a], [b]) => a.localeCompare(b)).slice(0, 60).map(([date, tokens]) => ({ date, tokens })) };
}
