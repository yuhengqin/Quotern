import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const bin = fileURLToPath(new URL(process.env.QUOTERN_CLI_TEST_DIST ? `${process.env.QUOTERN_CLI_TEST_DIST}/index.js` : '../bin/quotern.js', import.meta.url));
test('prompt, recommendation and provider descriptions remain read-only without runtime storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-workflows-')), dir = join(root, 'absent');
  try {
    const prompt = await run(process.execPath, [bin, 'prompt', '--data-dir', dir]);
    assert.equal(prompt.stdout.trim(), 'Quotern quota unknown');
    const result = await run(process.execPath, [bin, 'quota', 'recommend', '--provider', 'claude', '--model', 'opus', '--json', '--data-dir', dir]);
    assert.equal(JSON.parse(result.stdout).result, 'unknown');
    const metadata = await run(process.execPath, [bin, 'quota', 'providers', '--json', '--data-dir', dir]);
    assert.equal(JSON.parse(metadata.stdout).providers.length, 13);
    assert.deepEqual(await readdir(root), []);
    for (const args of [['recommend', '--provider', 'claude', '--refresh'], ['recommend', '--model', 'opus'], ['status', '--model', 'opus']]) {
      await assert.rejects(run(process.execPath, [bin, 'quota', ...args, '--data-dir', dir]), e => e.code === 1 && !e.stdout);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
