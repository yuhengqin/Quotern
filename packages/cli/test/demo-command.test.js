import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/quotern.js', import.meta.url));

test('demo grammar requires explicit artifacts and rejects ambiguous flags', async () => {
  const mod = await import('../dist/demo.js').catch(() => ({}));
  assert.equal(typeof mod.parseDemoArgs, 'function');
  assert.deepEqual(mod.parseDemoArgs(['start', '--file', 'demo.json']), { action: 'start', file: 'demo.json', host: '127.0.0.1', port: 8253 });
  assert.deepEqual(mod.parseDemoArgs(['export', '--out', 'demo.json', '--data-dir', 'source']), { action: 'export', out: 'demo.json', dataDir: 'source' });
  for (const args of [[], ['start'], ['export'], ['start', '--file', 'a', '--file', 'b'], ['export', '--out', 'a', '--host', '0.0.0.0'], ['start', '--file', 'a', '--port', '0'], ['start', '--file', 'a', '--wat']]) assert.throws(() => mod.parseDemoArgs(args));
});

test('CLI exports and serves a separate demo without ownership, hooks, normal config or data writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-demo-cli-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), normal = join(root, 'normal'), file = join(root, 'demo.json');
  await mkdir(join(source, 'queue'), { recursive: true }); await mkdir(normal);
  await writeFile(join(normal, 'sentinel'), 'untouched'); await writeFile(join(source, 'config.json'), JSON.stringify({ statsSince: '2020-01-01T00:00:00Z', token: 'PRIVATE_SECRET' }));
  await writeFile(join(source, 'queue', '2020-01.jsonl'), JSON.stringify({ source: 'codex', model: 'gpt-6.1-sol', project: 'PRIVATE_PROJECT', hour_start: '2020-01-05T08:00:00Z', input_tokens: 100, output_tokens: 2, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 102, conversation_count: 1 }) + '\n');
  const env = { ...process.env, QUOTERN_DATA_DIR: normal, QUOTERN_CONFIG_HOME: join(root, 'identity'), QUOTERN_DEBUG: '1' };
  const before = await readFile(join(source, 'config.json'), 'utf8');
  const output = await run(process.execPath, [bin, 'demo', 'export', '--data-dir', source, '--out', file], { env, timeout: 15_000 });
  assert.equal(output.stderr, ''); assert.equal((await readFile(file, 'utf8')).includes('PRIVATE_'), false);
  const { createServer } = await import('node:net'); const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [bin, 'demo', 'start', '--file', file, '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} if (i > 100 || child.exitCode !== null) assert.fail(`demo did not start: ${logs}`); await new Promise(resolve => setTimeout(resolve, 50)); }
  const summary = await (await fetch(`${base}/functions/tud-usage-summary`)).json(); assert.equal(summary.data.todayTokens, 102);
  const denied = await fetch(`${base}/functions/tud-trigger-sync`, { method: 'POST', body: '{}' }); assert.equal(denied.status, 403);
  assert.ok((await (await fetch(base)).text()).includes('id="quotern-demo"'));
  child.kill(); await new Promise(resolve => child.once('exit', resolve));
  assert.deepEqual(await readdir(normal), ['sentinel']); assert.equal(await readFile(join(source, 'config.json'), 'utf8'), before);
  await assert.rejects(run(process.execPath, [bin, 'demo', 'start', '--file', join(root, 'missing')], { env, timeout: 5000 }));
  assert.deepEqual(await readdir(normal), ['sentinel']);
});
