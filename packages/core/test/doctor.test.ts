import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { runDoctorDiagnostics } from '../src/doctor.js';
import { cursorsPath } from '../src/paths.js';
import { pidFilePath } from '../src/runtime-pid.js';
import { SYNC_SOURCE_IDS } from '../src/sync/index.js';
import type { TudConfig } from '../src/types.js';

function mockConfig(dir: string, overrides: Partial<TudConfig> = {}): TudConfig {
  return {
    deviceId: 'test-device-uuid',
    hostname: 'test-host',
    dataDir: dir,
    statsSince: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function withIsolatedConfigHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'quotern-doctor-cfg-home-'));
  const prev = process.env.QUOTERN_CONFIG_HOME;
  process.env.QUOTERN_CONFIG_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.QUOTERN_CONFIG_HOME;
    else process.env.QUOTERN_CONFIG_HOME = prev;
  }
}

function findItem(
  report: Awaited<ReturnType<typeof runDoctorDiagnostics>>,
  categoryId: string,
  itemId: string,
) {
  const category = report.categories.find((c) => c.id === categoryId);
  assert.ok(category, `missing category ${categoryId}`);
  const item = category.items.find((i) => i.id === itemId);
  assert.ok(item, `missing item ${itemId}`);
  return item;
}

test('runDoctorDiagnostics returns structured diagnostic report', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'quotern-doctor-test-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    port: 65432,
    skipNetworkProbe: true,
  });

  assert.ok(report.timestamp);
  assert.equal(report.categories.length, 3);

  const nodeItem = findItem(report, 'runtime', 'runtime-node');
  assert.equal(nodeItem.status, 'ok');

  const dataDirItem = findItem(report, 'storage', 'storage-datadir');
  assert.equal(dataDirItem.status, 'ok');

  const collectorsCat = report.categories.find((c) => c.id === 'collectors');
  assert.ok(collectorsCat);
  assert.equal(report.collectors.total, SYNC_SOURCE_IDS.length);

  const networkCat = report.categories.find((c) => c.id === 'network');
  assert.equal(networkCat, undefined);

  assert.ok(report.summary.okCount > 0);
  assert.equal(typeof report.summary.errorCount, 'number');
  assert.equal(typeof report.summary.warnCount, 'number');
});

test('collectors use sync source ids, not catalog integration keys', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'quotern-doctor-collectors-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });

  const keys = report.collectors.items.map((item) => item.key);
  assert.deepEqual(keys, [...SYNC_SOURCE_IDS]);
  assert.equal(
    report.collectors.items.find((item) => item.key === 'claude-code'),
    undefined,
  );
  assert.equal(
    report.collectors.items.find((item) => item.key === 'qwen-code'),
    undefined,
  );

  const claude = report.collectors.items.find((item) => item.key === 'claude');
  assert.ok(claude);
  assert.equal(claude.displayName, 'Claude Code');
  assert.ok(claude.hookStatus === 'active' || claude.hookStatus === 'inactive');

  const qwen = report.collectors.items.find((item) => item.key === 'qwen');
  assert.ok(qwen);
  assert.equal(qwen.displayName, 'Qwen Code');
  assert.equal(qwen.hookStatus, undefined);

  const qwenwork = report.collectors.items.find((item) => item.key === 'qwenwork');
  assert.ok(qwenwork);
  assert.equal(qwenwork.displayName, 'QwenWork');

  const commandCode = report.collectors.items.find((item) => item.key === 'command-code');
  assert.ok(commandCode);
  assert.equal(commandCode.displayName, 'Command Code');
});

test('runDoctorDiagnostics clears a stale tud.pid lock', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'quotern-doctor-pid-test-'));
  const deadPid = 9999999;
  await writeFile(
    join(tempDir, 'tud.pid'),
    JSON.stringify({ pid: deadPid, kind: 'cli' }),
  );

  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });

  const pidItem = findItem(report, 'runtime', 'runtime-pid');
  assert.equal(pidItem.status, 'info');
  assert.match(pidItem.message, /已清理失效的锁文件/);
  assert.ok(pidItem.message.includes(String(deadPid)));
  assert.equal(existsSync(pidFilePath(tempDir)), false);
  assert.equal(
    report.summary.suggestions.some((s) => s.includes('rm') || s.includes('Remove-Item')),
    false,
  );
});

test('unreadable tud.pid is cleared and reported', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'quotern-doctor-pid-junk-'));
  await writeFile(join(tempDir, 'tud.pid'), 'not-a-pid');

  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });

  const pidItem = findItem(report, 'runtime', 'runtime-pid');
  assert.equal(pidItem.status, 'info');
  assert.match(pidItem.message, /已清理无法识别的 tud\.pid/);
  assert.equal(existsSync(pidFilePath(tempDir)), false);
});

test('cursors are read from cursorsPath, not queue/cursors.json', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'quotern-doctor-cursors-'));
  await mkdir(join(tempDir, 'queue'), { recursive: true });
  await writeFile(join(tempDir, 'queue', 'cursors.json'), '{"claude":{}}');

  const misplaced = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });
  const misplacedItem = findItem(misplaced, 'storage', 'storage-cursors');
  assert.equal(misplacedItem.status, 'info');
  assert.match(misplacedItem.message, /尚未产生/);

  await writeFile(cursorsPath(tempDir), '{"claude":{},"codex":{}}');
  const placed = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });
  const placedItem = findItem(placed, 'storage', 'storage-cursors');
  assert.equal(placedItem.status, 'ok');
  assert.match(placedItem.message, /2 个数据源/);
});

test('panel port falls back to config.serverPort', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'quotern-doctor-port-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir, { serverPort: 9000 }),
    skipNetworkProbe: true,
  });

  const portItem = findItem(report, 'runtime', 'runtime-port');
  assert.match(portItem.message, /9000/);
});

test('corrupt config.json is reported as recovered, not healthy', async () => {
  await withIsolatedConfigHome(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'quotern-doctor-corrupt-'));
    await writeFile(join(dir, 'config.json'), '{not-json', 'utf8');
    const report = await runDoctorDiagnostics({
      dataDir: dir,
      skipNetworkProbe: true,
    });
    const configItem = findItem(report, 'storage', 'storage-config');
    assert.equal(configItem.status, 'warn');
    assert.match(configItem.message, /已自动恢复/);
    assert.match(configItem.detail ?? '', /config\.json\.bak/);
  });
});
