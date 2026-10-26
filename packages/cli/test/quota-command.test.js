import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { createServer } from 'node:http';
import { projectQuotaReport } from 'quotern-core/quota/report';
import { normalizeQuotaSnapshot } from 'quotern-core/quota/shared/quota-analysis';
import { DEFAULT_QUOTA_PREFERENCES } from 'quotern-core/quota/shared/quota';
const run = promisify(execFile);
const bin = fileURLToPath(new URL(process.env.QUOTERN_CLI_TEST_DIST ? `${process.env.QUOTERN_CLI_TEST_DIST}/index.js` : '../bin/quotern.js', import.meta.url));
function state() {
  return { providers: [normalizeQuotaSnapshot('codex', 'Codex', { status: 'ready', fetchedAt: Date.now() / 1000, windows: [{ id: 'weekly', label: '7d', usedPercent: 31, resetsAt: Date.now() / 1000 + 1000 }] })], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null };
}

test('quota reads Desktop snapshot without starting services or modifying local files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-quota-command-'));
  try {
    await mkdir(join(dir, 'quota-snapshots'));
    const files = { 'config.json': '{broken-secret', 'tud.pid': JSON.stringify({ pid: process.pid, kind: 'desktop' }),
      'quota-snapshots/desktop.json': JSON.stringify({ ...projectQuotaReport(state(), 'desktop'), secret: 'Bearer private' }) };
    for (const [file, content] of Object.entries(files)) await writeFile(join(dir, file), content);
    const before = (await readdir(dir, { recursive: true })).sort();
    for (const view of ['status', 'forecast', 'diagnostics']) {
      const result = await run(process.execPath, [bin, 'quota', view, '--json', '--data-dir', dir], { timeout: 15000 });
      const report = JSON.parse(result.stdout);
      assert.equal(report.runtime, 'desktop'); assert.equal(report.providers[0].provider, 'codex');
      assert.equal(report.view, view); assert.equal(result.stderr, ''); assert.doesNotMatch(result.stdout, /secret|private/);
    }
    const missing = await run(process.execPath, [bin, 'quota', '--json', '--data-dir', join(dir, 'absent')]);
    assert.equal(JSON.parse(missing.stdout).availability, 'missing');
    await assert.rejects(run(process.execPath, [bin, 'quota', '--refresh', '--runtime', 'desktop', '--data-dir', dir]), e => e.code === 1 && /Desktop/.test(e.stderr) && e.stdout === '');
    for (const [file, content] of Object.entries(files)) assert.equal(await readFile(join(dir, file), 'utf8'), content);
    assert.deepEqual((await readdir(dir, { recursive: true })).sort(), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('quota rejects ambiguous or unsupported command options before any runtime access', async () => {
  for (const args of [['--provider', 'nope'], ['--runtime', 'nope'], ['--refresh=false'], ['--port', '0'], ['--format', 'csv'], ['status', 'forecast'], ['--json', '--json']]) {
    await assert.rejects(run(process.execPath, [bin, 'quota', ...args]), e => e.code === 1 && e.stdout === '');
  }
});

test('quota text and JSON preserve zero balance and unlimited quota semantics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-quota-values-'));
  try {
    const value = state();
    value.providers = [normalizeQuotaSnapshot('deepseek', 'DeepSeek', { status: 'ready', fetchedAt: Date.now() / 1000, limits: [{ id: 'balance-cny', label: 'CNY balance', usedPercent: 0, remaining: 0 }] }),
      normalizeQuotaSnapshot('copilot', 'Copilot', { status: 'ready', fetchedAt: Date.now() / 1000, limits: [{ id: 'chat', label: 'Chat', unlimited: true }] })];
    await mkdir(join(dir, 'quota-snapshots'));
    await writeFile(join(dir, 'quota-snapshots', 'desktop.json'), JSON.stringify(projectQuotaReport(value, 'desktop')));
    const result = await run(process.execPath, [bin, 'quota', '--lang', 'en', '--data-dir', dir]);
    assert.match(result.stdout, /balance: 0.00 CNY/); assert.match(result.stdout, /chat: unlimited/);
    assert.doesNotMatch(result.stdout, /0.0% used/);
    const json = await run(process.execPath, [bin, 'quota', '--json', '--data-dir', dir]);
    assert.equal(JSON.parse(json.stdout).providers[0].windows[0].usedPercent, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('explicit refresh uses only the named local HTTP runtime and projects a safe report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-quota-refresh-'));
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    calls.push({ method: req.method, url: req.url, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, data: state() }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run(process.execPath, [bin, 'quota', 'status', '--refresh', '--port', String(server.address().port), '--data-dir', dir, '--provider', 'codex', '--json']);
    assert.equal(JSON.parse(result.stdout).providers[0].windows[0].usedPercent, 31);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].body.provider, 'codex');
    assert.match(calls[0].body.directoryKey, /^[0-9a-f]{64}$/);
    assert.equal(calls[0].url, '/functions/tud-quota/refresh');
    assert.deepEqual(await readdir(dir), []);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
