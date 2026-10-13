import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfig,
  salvageIdentityFromCorruptConfig,
} from '../src/config.js';
import { configPath } from '../src/paths.js';

async function withIsolatedConfigHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'quotern-cfg-home-'));
  const prev = process.env.QUOTERN_CONFIG_HOME;
  process.env.QUOTERN_CONFIG_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.QUOTERN_CONFIG_HOME;
    else process.env.QUOTERN_CONFIG_HOME = prev;
    await rm(home, { recursive: true, force: true });
  }
}

test('salvageIdentityFromCorruptConfig extracts only device identity', () => {
  const raw = `{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "test-host",
}`;
  assert.deepEqual(salvageIdentityFromCorruptConfig(raw), {
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
  });
  assert.deepEqual(salvageIdentityFromCorruptConfig('{not json'), {});
});

test('loadConfig recovers device identity from corrupt JSON', async () => {
  await withIsolatedConfigHome(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-usage-cfg-'));
    await writeFile(
      configPath(dir),
      `{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "test-host",
`,
      'utf8',
    );
    const result = await loadConfig(dir);
    assert.ok(result.recoveredFromCorrupt);
    assert.equal(result.recoveredFromCorrupt?.tokenSalvaged, false);
    assert.equal(result.recoveredFromCorrupt?.deviceIdSalvaged, true);
    assert.equal(result.config.deviceId, '550e8400-e29b-41d4-a716-446655440000');
    const written = JSON.parse(await readFile(configPath(dir), 'utf8')) as {
      deviceId: string;
    };
    assert.equal(written.deviceId, '550e8400-e29b-41d4-a716-446655440000');
    const names = await readdir(dir);
    assert.ok(names.some((name) => name.startsWith('config.json.bak.')));
  });
});

test('loadConfig recovers from non-object JSON without salvaged token', async () => {
  await withIsolatedConfigHome(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-usage-cfg-'));
    await writeFile(configPath(dir), '[]', 'utf8');
    const result = await loadConfig(dir);
    assert.ok(result.recoveredFromCorrupt);
    assert.equal(result.recoveredFromCorrupt?.tokenSalvaged, false);
    assert.match(result.config.deviceId, /^[0-9a-f-]{36}$/i);
  });
});
