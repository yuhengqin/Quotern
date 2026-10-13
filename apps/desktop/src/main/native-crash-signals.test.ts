import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import './native-crash-signals.js';

const coreRequire = createRequire(join(__dirname, '../../../../packages/core/package.json'));
const lockfilePath = coreRequire.resolve('proper-lockfile');
const handlerPath = require.resolve('./native-crash-signals.js');
const setup = `
  require(${JSON.stringify(lockfilePath)});
  const { restoreNativeTrapHandler } = require(${JSON.stringify(handlerPath)});
`;

test('restores native traps while preserving normal exit cleanup', {
  skip: process.platform === 'win32',
}, () => {
  const result = spawnSync(process.execPath, ['-e', `${setup}
    const assert = require('node:assert/strict');
    assert.ok(process.listenerCount('SIGTRAP') > 0);
    const signals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'exit'];
    const before = signals.map(signal => process.listeners(signal));
    assert.ok(before[0].length > 0);
    restoreNativeTrapHandler();
    restoreNativeTrapHandler();
    assert.equal(process.listenerCount('SIGTRAP'), 0);
    signals.forEach((signal, i) => assert.deepEqual(process.listeners(signal), before[i]));
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('a synchronous native trap exits instead of wedging the event loop', {
  skip: !['darwin', 'linux'].includes(process.platform)
    || !['arm64', 'x64'].includes(process.arch),
}, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'quotern-native-trap-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'trap.c');
  const addon = join(dir, 'trap.node');
  // A native synchronous trap is required: process.kill sends an asynchronous
  // signal, and Electron's process.crash uses SIGSEGV rather than SIGTRAP.
  writeFileSync(source, `
    void *napi_register_module_v1(void *env, void *exports) {
      (void)env;
      #if defined(__aarch64__)
      __asm__ volatile("brk #0");
      #elif defined(__x86_64__)
      __asm__ volatile("int3");
      #endif
      return exports;
    }
  `);
  const flags = process.platform === 'darwin'
    ? ['-bundle', '-undefined', 'dynamic_lookup']
    : ['-shared', '-fPIC'];
  const compiled = spawnSync('cc', [...flags, '-o', addon, source], {
    encoding: 'utf8', timeout: 30_000,
  });
  if ((compiled.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    t.skip('native trap regression requires a C compiler');
    return;
  }
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, compiled.stderr);
  const result = spawnSync(process.execPath, ['-e', `${setup}
    restoreNativeTrapHandler();
    require(${JSON.stringify(addon)});
  `], { cwd: dir, encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.equal(result.signal, 'SIGTRAP', result.stderr);
});
