import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { protectedSessionPids } from '../src/runtime-supervisor.js';

test('production takeover protects a dev CLI and descendants even without Vite', () => {
  const protectedPids = protectedSessionPids([
    { pid: 1, ppid: 0, args: 'production-desktop' },
    { pid: 20, ppid: 0, args: 'node quotern.js start --quotern-dev-instance abc' },
    { pid: 21, ppid: 20, args: 'node worker.js' },
    { pid: 30, ppid: 0, args: 'node /repo/scripts/dev.mjs api' },
    { pid: 31, ppid: 30, args: 'node quotern.js start' },
  ], 1);
  for (const pid of [20, 21, 30, 31]) assert.ok(protectedPids.has(pid), `dev pid ${pid} must survive`);
});

test('isolated Core writes identity and config privately without replacing user hooks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'quotern-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const urls = ['paths', 'config', 'hooks/claude', 'hooks/codex', 'hooks/codex-hooks-json']
    .map((name) => new URL(`../src/${name}.js`, import.meta.url).href);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdir, readFile, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const [paths, config, claude, codex, hooks] = await Promise.all(${JSON.stringify(urls)}.map((url) => import(url)));
    const settings = paths.claudeSettingsPath();
    const codexConfig = paths.codexConfigPath();
    const codexHooks = paths.codexHooksJsonPath();
    for (const file of [settings, codexConfig, codexHooks]) {
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, 'original-user-state');
    }
    const loaded = await config.loadConfig();
    assert.equal(loaded.dir, process.env.QUOTERN_DATA_DIR);
    await claude.setupClaudeHook(loaded.dir);
    await codex.setupCodexHook(loaded.dir);
    await claude.upsertClaudeHook('dev-notify');
    await hooks.upsertCodexHooksJson('dev-notify');
    for (const file of [settings, codexConfig, codexHooks]) assert.equal(await readFile(file, 'utf8'), 'original-user-state');
    assert.equal((await readFile(paths.stableDeviceIdPath(), 'utf8')).trim(), loaded.config.deviceId);
  `], { encoding: 'utf8', timeout: 10000, env: {
    ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: join(root, '.codex'),
    AI_USAGE_CODEX_HOME: join(root, '.codex'), QUOTERN_DEV_ISOLATED: '1',
    QUOTERN_DATA_DIR: join(root, 'private-data'), QUOTERN_CONFIG_HOME: join(root, 'private-config'),
  } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
