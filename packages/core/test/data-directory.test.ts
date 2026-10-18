import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const configUrl = new URL('../src/config.js', import.meta.url).href;

function checkDirectory(t: { after: (fn: () => void) => void }, isolated = false, custom = false) {
  const home = mkdtempSync(join(tmpdir(), 'quotern-data-directory-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = isolated ? join(home, 'worktree', '.quotern-dev', 'data')
    : custom ? join(home, 'custom') : join(home, '.quotern');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFile, readdir } from 'node:fs/promises';
    import { join } from 'node:path';
    const { loadConfig } = await import(${JSON.stringify(configUrl)});
    const expected = ${JSON.stringify(directory)};
    const loaded = await loadConfig(${custom ? JSON.stringify(directory) : ''});
    assert.equal(loaded.dir, expected);
    assert.equal(JSON.parse(await readFile(join(expected, 'config.json'), 'utf8')).dataDir, expected);
    assert.equal((await loadConfig(${custom ? JSON.stringify(directory) : ''})).config.deviceId, loaded.config.deviceId);
    assert.deepEqual((await readdir(process.env.USERPROFILE)).sort(),
      ${JSON.stringify([isolated ? 'worktree' : custom ? 'custom' : '.quotern', 'identity'].sort())});
  `], { encoding: 'utf8', timeout: 10000, env: {
    ...process.env, HOME: home, USERPROFILE: home,
    QUOTERN_CONFIG_HOME: join(home, 'identity'),
    QUOTERN_DEV_ISOLATED: isolated ? '1' : '',
    QUOTERN_DATA_DIR: isolated ? directory : '',
  } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('production creates branded data and retains identity without extra directory entries', (t) => checkDirectory(t));
test('explicit data directories remain independent', (t) => checkDirectory(t, false, true));
test('isolated development writes only its worktree data and private identity', (t) => checkDirectory(t, true));
