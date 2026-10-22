import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import type { TudConfig } from '../src/types.js';

test('shared achievement API reads complete disk history independently of current dashboard floor and validates local mutations', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-awards-api-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(join(dataDir, 'queue'));
  const row = { hour_start: '2024-01-01T00:00:00Z', source: 'codex', model: 'gpt-5', project: 'app', input_tokens: 1000000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000000, conversation_count: 1 };
  await writeFile(join(dataDir, 'queue', '2024-01.jsonl'), JSON.stringify(row) + '\n');
  const app = createLocalApiApp({ dataDir, bucketStore: new BucketStore(), getConfig: () => ({ deviceId: 'test', statsSince: '2026-10-01T00:00:00Z' } as TudConfig) });
  const path = '/functions/tud-achievements';
  const response = await app.request(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.data.summary.totalTokens, 1000000);
  assert.equal(body.data.coverage.fromDate, '2024-01-01');
  const post = (input: unknown, origin = 'http://localhost:5194') => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(input) });
  assert.equal((await post({ operation: 'preferences', showcaseIds: ['tokens-1000000'] })).status, 200);
  assert.equal((await post({ operation: 'preferences', showcaseIds: ['tokens-1000000000'] })).status, 400);
  assert.equal((await post({ operation: 'preferences', celebrationsEnabled: 'yes' })).status, 400);
  assert.equal((await post({ operation: 'remove-everything' })).status, 400);
  assert.equal((await post({ operation: 'claim-notice' }, 'https://evil.example')).status, 403);
  assert.equal((await app.request(path, { headers: { Origin: 'null' } })).status, 403);
  const malformed = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400);
  const reopened = await (await app.request(path)).json();
  assert.deepEqual(reopened.data.preferences.showcaseIds, ['tokens-1000000']);
});

test('achievement origins use the requested LAN host while preserving local and fallback access', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-awards-lan-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = createLocalApiApp({ dataDir, bucketStore: new BucketStore(), getConfig: () => ({ deviceId: 'test' } as TudConfig) });
  const path = '/functions/tud-achievements';
  const post = (origin: string | undefined, host?: string, url = `http://0.0.0.0:8252${path}`) => app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(host ? { Host: host } : {}) },
    body: JSON.stringify({ operation: 'preferences', celebrationsEnabled: false }),
  });
  assert.equal((await post('http://192.168.0.50:5194', '192.168.0.50:8252')).status, 200);
  for (const origin of ['https://evil.example', 'http://192.168.0.51:5194', 'null', 'ftp://192.168.0.50']) {
    assert.equal((await post(origin, '192.168.0.50:8252')).status, 403, origin);
  }
  assert.equal((await post('http://127.0.0.1:5194', '192.168.0.50:8252')).status, 200);
  assert.equal((await post(undefined, '192.168.0.50:8252')).status, 200);
  assert.equal((await post('http://192.168.0.50:5194', undefined, `http://192.168.0.50:8252${path}`)).status, 200);
  for (const listenHost of ['0.0.0.0', '127.0.0.1']) {
    assert.equal((await post('http://evil.example:8252', 'evil.example:8252', `http://${listenHost}:8252${path}`)).status, 403);
  }
});
