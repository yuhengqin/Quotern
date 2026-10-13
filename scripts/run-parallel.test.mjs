import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL('./run-parallel.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'quotern-parallel-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'scripts', 'run-parallel.mjs');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(runner, script);
  const entry = join(root, 'package manager with spaces', 'pnpm.cjs');
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, `
    console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
  `);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path' || key.toLowerCase() === 'npm_execpath') delete env[key];
  }
  env.PATH = '';
  return { root, script, entry, env };
}

// Reverting to a bare pnpm spawn must fail when only its JS entry is available.
test('starts both scripts through the package manager entry without a PATH shim', (t) => {
  const { root, script, entry, env } = fixture(t);
  const result = spawnSync(process.execPath, [script, 'dev:cli:api', 'dev:cli:ui'], {
    env: { ...env, npm_execpath: entry },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const calls = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  calls.sort((a, b) => a.args.at(-1).localeCompare(b.args.at(-1)));
  assert.deepEqual(calls, [
    { args: ['-w', 'run', 'dev:cli:api'], cwd: root },
    { args: ['-w', 'run', 'dev:cli:ui'], cwd: root },
  ]);
});

test('reports a launch failure without an unhandled child process error', (t) => {
  const { script, env } = fixture(t);
  const result = spawnSync(process.execPath, [script, 'dev:cli:api'], {
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dev:cli:api.*ENOENT/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});

test('starts real pnpm lifecycle scripts on the current platform', {
  skip: !process.env.npm_execpath,
}, (t) => {
  const { root, script } = fixture(t);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'quotern-parallel-probe',
    private: true,
    scripts: { api: 'node api.cjs', ui: 'node ui.cjs' },
  }));
  writeFileSync(join(root, 'api.cjs'), "console.log('api-started');\n");
  writeFileSync(join(root, 'ui.cjs'), "console.log('ui-started');\n");
  const result = spawnSync(process.execPath, [script, 'api', 'ui'], {
    env: process.env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^api-started\r?$/m);
  assert.match(result.stdout, /^ui-started\r?$/m);
});
