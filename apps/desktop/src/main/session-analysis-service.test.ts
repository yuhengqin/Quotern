import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { isSessionAnalysisRequest, type AnalysisRequest, type AnalysisResult } from './session-analysis-protocol.js';

test('analysis only accepts exact read-only routes', () => {
  assert.equal(isSessionAnalysisRequest('/functions/tud-session-detail?source=claude&sessionId=one'), true);
  for (const url of ['/functions/tud-session-detail/extra', '/functions/tud-session-list-other', '/functions/tud-config', '/functions/tud-sync']) assert.equal(isSessionAnalysisRequest(url), false);
  assert.equal(isSessionAnalysisRequest('/functions/tud-session-list', 'POST'), false);
});

test('analysis uses current buckets and layered pricing while preserving validation and fresh session history', async t => {
  const core = await import('quotern-core');
  const original = core.getPricingSnapshot(); t.after(() => core.applyPricingSnapshot(original));
  const collector = await import(pathToFileURL(join(__dirname, '../../../../packages/core/dist/session-collector.js')).href);
  const directory = await mkdtemp(join(tmpdir(), 'quotern-analysis-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'fixture.jsonl');
  const write = async (tokens: number) => {
    await writeFile(input, JSON.stringify({ type: 'assistant', sessionId: 'one', cwd: 'C:/fixture', timestamp: '2026-10-16T04:00:00Z', message: { id: 'message', model: 'fixture', usage: { input_tokens: tokens, output_tokens: 0 } } }) + '\n');
    await collector.syncSessionSource(directory, 'claude', { complete: true, inputs: [{ path: input, sessionId: 'one', kind: 'jsonl' }] });
  };
  await write(1000);
  const code = transformSync(await readFile(join(__dirname, '../../src/main/session-analysis-service.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id: string) => id === 'quotern-core' ? core : require(id), module, module.exports);
  const { SessionAnalysisService } = module.exports as { SessionAnalysisService: new () => { request(request: AnalysisRequest): Promise<AnalysisResult> } };
  const service = new SessionAnalysisService();
  const url = 'http://tud.local/functions/tud-session-activity?fromDate=2026-10-16&toDate=2026-10-16';
  const request: AnalysisRequest = { type: 'request', id: 1, url, snapshot: {
    dataDir: directory, config: { statsSince: '2026-01-01T00:00:00Z' } as AnalysisRequest['snapshot']['config'], collectSince: '2026-01-01T00:00:00Z', bucketRevision: 1,
    rows: [{ source: 'claude', model: 'fixture', project: 'fixture', hour_start: '2026-10-16T04:00:00Z', input_tokens: 2000, total_tokens: 2000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 1 }],
    pricingFingerprint: 'first', pricing: { builtin: { exact: { fixture: { input: 1 } } }, overlay: null }, quotaState: null,
  } };
  const first = await service.request(request);
  const data = (first.body as { data: { totalTokens: number; sessions: Array<{ tokens: number; costUsd: number }> } }).data;
  assert.equal(first.status, 200); assert.equal(data.totalTokens, 2000); assert.equal(data.sessions[0]!.tokens, 1000); assert.equal(data.sessions[0]!.costUsd, 0.001);
  const warm: AnalysisRequest = { ...request, id: 2, snapshot: { ...request.snapshot, rows: undefined, pricing: undefined } };
  assert.deepEqual((await service.request(warm)).body, first.body, 'unchanged snapshots keep a usable app and range cache');
  await write(3000);
  assert.equal(((await service.request(warm)).body as { data: { sessions: Array<{ tokens: number }> } }).data.sessions[0]!.tokens, 3000, 'session-only changes remain visible without new buckets');
  const priced = await service.request({ ...warm, snapshot: { ...warm.snapshot, pricingFingerprint: 'second', pricing: { builtin: { exact: { fixture: { input: 2 } } }, overlay: null } } });
  assert.equal((priced.body as { data: { sessions: Array<{ costUsd: number }> } }).data.sessions[0]!.costUsd, 0.006);
  const current = { ...warm, snapshot: { ...warm.snapshot, pricingFingerprint: 'second' } };
  assert.equal((await service.request({ ...current, url: url.replace('activity', 'detail') + '&source=claude' })).status, 400);
  assert.equal((await service.request({ ...current, init: { headers: { Origin: 'https://evil.example' } } })).status, 403);
  await assert.rejects(service.request({ ...current, init: { method: 'POST' } }), /invalid/);
});
