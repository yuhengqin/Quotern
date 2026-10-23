import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { syncSessionSource } from '../../core/dist/session-collector.js';
const run = promisify(execFile);
const bin = fileURLToPath(new URL(process.env.QUOTERN_CLI_TEST_DIST ? `${process.env.QUOTERN_CLI_TEST_DIST}/index.js` : '../bin/quotern.js', import.meta.url));

test('sessions exports persisted filtered history without taking ownership or writing local state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-sessions-command-'));
  try {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ statsSince: '2026-01-01T00:00:00Z', token: 'PRIVATE_SECRET' }));
    await writeFile(join(dir, 'tud.pid'), JSON.stringify({ pid: process.pid, kind: 'desktop' }));
    const path = join(dir, 'claude.jsonl');
    await writeFile(path, [
      { type: 'assistant', sessionId: 's', cwd: 'C:/PRIVATE_DIRECTORY', timestamp: '2026-10-16T04:00:00Z', message: { id: 'm', model: 'fixture', usage: { input_tokens: 10, output_tokens: 2 } } },
      { type: 'custom-title', sessionId: 's', customTitle: '=1+1' },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    await syncSessionSource(dir, 'claude', { complete: true, inputs: [{ path, sessionId: 's', kind: 'jsonl' }] });
    const before = (await readdir(dir, { recursive: true })).sort();
    const cache = await readFile(join(dir, 'sessions', 'claude.json'), 'utf8');
    const pid = await readFile(join(dir, 'tud.pid'), 'utf8');
    const args = ['sessions', '--from', '2026-10-16', '--to', '2026-10-16', '--source', 'claude', '--model', 'fixture', '--data-dir', dir];
    const json = await run(process.execPath, [bin, ...args, '--json'], { timeout: 15000 });
    const report = JSON.parse(json.stdout); assert.equal(report.sessions.length, 1); assert.equal(report.sessions[0].tokens, 12);
    assert.ok(!json.stdout.includes('C:/PRIVATE_DIRECTORY')); assert.ok(!json.stdout.includes('PRIVATE_SECRET'));
    const csv = await run(process.execPath, [bin, ...args, '--csv'], { timeout: 15000 });
    assert.ok(csv.stdout.startsWith('"source","session_id","title",')); assert.ok(csv.stdout.includes("'=1+1"));
    assert.deepEqual((await readdir(dir, { recursive: true })).sort(), before);
    assert.equal(await readFile(join(dir, 'sessions', 'claude.json'), 'utf8'), cache);
    assert.equal(await readFile(join(dir, 'tud.pid'), 'utf8'), pid);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
