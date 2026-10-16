import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/quotern.js', import.meta.url));

test('usage queries persisted data while Desktop owns runtime without writing or starting a service', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-command-'));
  try {
    await mkdir(join(dir, 'queue'));
    const bucket = { source: 'codex', model: 'test-model', project: 'Project', hour_start: '2026-06-09T10:00:00Z', input_tokens: 100, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 120, conversation_count: 1, token_quality: 'recorded' };
    const contents = {
      'config.json': JSON.stringify({ statsSince: '2026-01-01T00:00:00Z', lastSyncAt: '2026-06-09T10:00:00Z', token: 'private-test-secret' }),
      'tud.pid': JSON.stringify({ pid: process.pid, kind: 'desktop' }),
      'queue/2026-06.jsonl': [JSON.stringify({ ...bucket, input_tokens: 1 }), JSON.stringify(bucket), '{partial:'].join('\n'),
    };
    for (const [file, value] of Object.entries(contents)) await writeFile(join(dir, file), value);
    const before = (await readdir(dir, { recursive: true })).sort();
    const args = ['usage', 'models', '--from', '2026-06-09', '--to', '2026-06-09', '--source', 'codex', '--data-dir', dir];
    const json = await run(process.execPath, [bin, ...args, '--json'], { timeout: 15_000 });
    const report = JSON.parse(json.stdout);
    assert.equal(report.summary.tokens, 120);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.coverage.snapshot, 'persisted');
    assert.equal(report.summary.costExplanation.tokenQualityTokens.recorded, 120);
    assert.equal(json.stdout.includes('private-test-secret'), false);
    const csv = await run(process.execPath, [bin, ...args, '--csv'], { timeout: 15_000 });
    assert.ok(csv.stdout.startsWith('period,label,source,model,'));
    await assert.rejects(run(process.execPath, [bin, 'usage', '--days', '0', '--json', '--data-dir', dir]), (error) => error.code === 1 && error.stdout === '' && /days/.test(error.stderr));
    await assert.rejects(run(process.execPath, [bin, 'usage', '--data-dir', join(dir, 'missing')]), (error) => error.code === 1 && /配置/.test(error.stderr));
    assert.deepEqual((await readdir(dir, { recursive: true })).sort(), before);
    for (const [file, value] of Object.entries(contents)) assert.equal(await readFile(join(dir, file), 'utf8'), value);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
