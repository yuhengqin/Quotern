import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { parseCodexIncremental } from '../src/parsers/codex.js';
import type { CursorsFile } from '../src/types.js';
import { resetSqliteQueryCache } from '../src/parsers/sqlite.js';

const timestamp = '2026-06-09T10:00:00Z';
const raw = (n: number) => ({ input_tokens: n, cached_input_tokens: 0, output_tokens: 0, total_tokens: n });
const event = (type: string, payload: unknown) => JSON.stringify({ type, timestamp, payload });
const meta = (id = 'session', parent?: string) => event('session_meta', { id, cwd: '/work/app', forked_from_id: parent });
const turn = event('turn_context', { model: 'normal-model' });
const usage = (id = 'response', n = 330) => event('token_usage_record', { response_id: id, model: 'compact-model', usage: raw(n) });
const marker = (id = 'response') => event('compacted', { compaction_response_id: id });
const token = (n: number) => event('event_msg', { type: 'token_count', info: { total_token_usage: raw(n) } });

async function fixture(run: (f: {
  file: string; write: (...lines: string[]) => Promise<void>; append: (...lines: string[]) => Promise<void>;
  scan: () => Promise<Awaited<ReturnType<typeof parseCodexIncremental>>>;
  ledger: (tokens: number) => void; cursor: () => CursorsFile;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'quotern-compaction-'));
  const keys = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'AI_USAGE_CODEX_HOME'] as const;
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.HOME = process.env.USERPROFILE = root;
  const home = join(root, '.codex'); process.env.CODEX_HOME = home; delete process.env.AI_USAGE_CODEX_HOME;
  const dir = join(home, 'sessions'); await mkdir(dir, { recursive: true });
  const file = join(dir, 'rollout-session.jsonl');
  let cursors: CursorsFile = {};
  try {
    await run({ file,
      write: (...lines) => writeFile(file, [...lines, ''].join('\n')),
      append: (...lines) => appendFile(file, [...lines, ''].join('\n')),
      scan: async () => { const result = await parseCodexIncremental(cursors, '2026-01-01T00:00:00Z'); cursors = JSON.parse(JSON.stringify(result.cursors)); return result; },
      cursor: () => cursors,
      ledger: (tokens) => {
        const db = new DatabaseSync(join(home, 'state_5.sqlite'));
        db.exec('CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, rollout_path TEXT, tokens_used INTEGER, model TEXT, cwd TEXT, recency_at_ms INTEGER)');
        db.prepare('INSERT OR REPLACE INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('session', file, tokens, 'normal-model', '/work/app', Date.parse(timestamp));
        db.close(); resetSqliteQueryCache();
      },
    });
  } finally {
    for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
    resetSqliteQueryCache(); await rm(root, { recursive: true, force: true });
  }
}
const sum = (result: Awaited<ReturnType<typeof parseCodexIncremental>>) => result.result.buckets.reduce((n, b) => n + b.total_tokens, 0);

test('compaction preserves cumulative baseline and request-local model', async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage(), marker(), token(180));
  const first = await f.scan();
  assert.equal(sum(first), 510);
  assert.equal(first.result.buckets.find((b) => b.model === 'normal-model')?.total_tokens, 180);
  assert.equal(first.result.buckets.find((b) => b.model === 'compact-model')?.total_tokens, 330);
  assert.equal(sum(await f.scan()), 0);
  await f.append(usage(), marker()); assert.equal(sum(await f.scan()), 0);
}));

for (const reverse of [false, true]) test(`compaction pairs across scans and restart, reverse=${reverse}`, async () => fixture(async (f) => {
  await f.write(meta(), turn, reverse ? marker() : usage()); assert.equal(sum(await f.scan()), 0);
  await f.append(reverse ? usage() : marker()); assert.equal(sum(await f.scan()), 330);
}));

test('advancing token_count covers latest matching record; repeated snapshot does not', async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage('local', 330), token(450), marker('local'));
  assert.equal(sum(await f.scan()), 450);
  await f.append(usage('remote', 450), token(450), marker('remote'));
  assert.equal(sum(await f.scan()), 450);
}));

test('a different latest response does not consume an earlier equal-sized compaction', async () => fixture(async (f) => {
  await f.write(meta(), turn, usage('compaction', 100), usage('ordinary', 100), token(100), marker('compaction'));
  assert.equal(sum(await f.scan()), 200);
}));

test('fork copies and window-excluded compaction do not re-emit', async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage(), marker()); assert.equal(sum(await f.scan()), 450);
  await writeFile(join(f.file, '..', 'rollout-child.jsonl'), [meta('child', 'session'), turn, token(120), usage(), marker(), ''].join('\n'));
  assert.equal(sum(await f.scan()), 0);
  await f.append(event('token_usage_record', { response_id: '', usage: raw(100) }), marker(''), marker('missing'));
  assert.equal(sum(await f.scan()), 0);
}));

for (const ledgerTokens of [120, 450]) test(`paired compaction does not duplicate ledger, ledger=${ledgerTokens}`, async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage(), marker()); f.ledger(ledgerTokens);
  assert.equal(sum(await f.scan()), 450);
  f.ledger(ledgerTokens); assert.equal(sum(await f.scan()), 0);
  await f.append(token(180)); f.ledger(ledgerTokens + 60); assert.equal(sum(await f.scan()), 60);
}));

for (const ledgerTokens of [220, 450]) test(`ledger credit survives late marker without duplicate, ledger=${ledgerTokens}`, async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage()); f.ledger(ledgerTokens);
  assert.equal(sum(await f.scan()), ledgerTokens);
  await f.append(marker());
  const second = await f.scan(); assert.equal(sum(second), 450 - ledgerTokens);
  if (ledgerTokens === 220) assert.equal(second.result.buckets[0]?.token_quality, 'ledger');
  f.ledger(450); assert.equal(sum(await f.scan()), 0);
}));

for (const hasLedger of [false, true]) test(`old cursor replays compaction once with conservative ledger overlap, ledger=${hasLedger}`, async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage(), marker());
  if (hasLedger) f.ledger(450);
  await f.scan();
  // Simulate the old parser's cursor: ordinary event hashes and byte offset,
  // but no knowledge of the compaction records preceding that offset.
  delete f.cursor().codex!.compactions;
  delete f.cursor().codex!.meteringVersion;
  assert.equal(sum(await f.scan()), hasLedger ? 0 : 330);
  assert.equal(sum(await f.scan()), 0);
}));

test('compaction before collection floor is observed but not emitted by the ledger', async () => fixture(async (f) => {
  const oldUsage = usage().replace(timestamp, '2025-01-01T10:00:00Z');
  await f.write(meta(), turn, token(120), oldUsage, marker()); f.ledger(450);
  assert.equal(sum(await f.scan()), 120);
}));

test('archive replay cannot consume a pending request with an earlier equal-sized ordinary event', async () => fixture(async (f) => {
  await f.write(meta(), turn, token(330), usage()); assert.equal(sum(await f.scan()), 330);
  const archive = join(f.file, '..', '..', 'archived_sessions'); await mkdir(archive);
  const moved = join(archive, 'rollout-session.jsonl'); await rename(f.file, moved);
  assert.equal(sum(await f.scan()), 0);
  await appendFile(moved, marker() + '\n'); assert.equal(sum(await f.scan()), 330);
}));

test('upgrading preserves the old ledger credit when ordinary usage grows after its byte boundary', async () => fixture(async (f) => {
  await f.write(meta(), turn, token(120), usage(), marker()); f.ledger(450); await f.scan();
  delete f.cursor().codex!.compactions; delete f.cursor().codex!.meteringVersion;
  await f.append(token(180));
  assert.equal(sum(await f.scan()), 60);
}));
