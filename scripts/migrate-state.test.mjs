import assert from 'node:assert/strict';
import fs, { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { migrateState } from './migrate-state.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'quotern-state-migration-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const from = join(base, 'previous-profile');
  const to = join(base, 'quotern');
  await mkdir(from);
  return { base, from, to };
}

test('migration preserves device identity, preferences and binary session data without deleting the source', async (t) => {
  const { from, to } = await fixture(t);
  await mkdir(join(from, 'Local Storage', 'leveldb'), { recursive: true });
  const files = {
    'device-id': Buffer.from('550e8400-e29b-41d4-a716-446655440000\n'),
    'desktop-prefs.json': Buffer.from('{"theme":"dark","launchAtLogin":true}'),
    'auto-update.json': Buffer.from('{"version":"0.1.13"}'),
    'Local Storage/leveldb/000001.ldb': Buffer.from([0, 255, 1, 128, 42]),
  };
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(from, name), bytes);
  await chmod(join(from, 'device-id'), 0o600);
  assert.equal((await migrateState(from, to)).status, 'copied');
  for (const [name, bytes] of Object.entries(files)) {
    assert.deepEqual(await readFile(join(to, name)), bytes);
    assert.deepEqual(await readFile(join(from, name)), bytes);
  }
  if (process.platform !== 'win32') assert.equal((await lstat(join(to, 'device-id'))).mode & 0o777, 0o600);
});

test('migration is repeatable when the destination already matches', async (t) => {
  const { from, to } = await fixture(t);
  await writeFile(join(from, 'device-id'), 'same-device');
  await migrateState(from, to);
  const before = await lstat(join(to, 'device-id'));
  assert.equal((await migrateState(from, to)).status, 'already-copied');
  assert.equal((await lstat(join(to, 'device-id'))).ino, before.ino);
});

test('conflicting destination is never overwritten or merged', async (t) => {
  const { base, from, to } = await fixture(t);
  await writeFile(join(from, 'desktop-prefs.json'), 'old preferences');
  await mkdir(to);
  await writeFile(join(to, 'desktop-prefs.json'), 'current preferences');
  await assert.rejects(migrateState(from, to), /Destination already exists/);
  assert.equal(await readFile(join(to, 'desktop-prefs.json'), 'utf8'), 'current preferences');
  assert.equal(await readFile(join(from, 'desktop-prefs.json'), 'utf8'), 'old preferences');
  assert.deepEqual((await readdir(base)).sort(), ['previous-profile', 'quotern']);
});

test('empty destination is also preserved for explicit conflict resolution', async (t) => {
  const { from, to } = await fixture(t);
  await writeFile(join(from, 'device-id'), 'identity');
  await mkdir(to);
  await assert.rejects(migrateState(from, to), /Destination already exists/);
  assert.deepEqual(await readdir(to), []);
});

test('nested destination and same-directory migration are rejected before copying', async (t) => {
  const { from } = await fixture(t);
  await assert.rejects(migrateState(from, join(from, 'quotern')), /separate directories/);
  await assert.rejects(migrateState(from, from), /separate directories/);
  assert.deepEqual(await readdir(from), []);
});

test('missing source and file source fail without creating a destination', async (t) => {
  const { base, to } = await fixture(t);
  await assert.rejects(migrateState(join(base, 'missing'), to), /ENOENT/);
  await writeFile(join(base, 'file'), 'data');
  await assert.rejects(migrateState(join(base, 'file'), to), /Source must be a directory/);
  await assert.rejects(lstat(to), /ENOENT/);
});

test('a destination created concurrently at publication is never replaced', async (t) => {
  const { from, to } = await fixture(t);
  await writeFile(join(from, 'device-id'), 'preserved identity');
  const originalMkdir = fs.mkdir;
  const originalRename = fs.rename;
  let created;
  async function competingDirectory() {
    if (!created) {
      await originalMkdir(to, { mode: 0o700 });
      created = await lstat(to);
    }
  }
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === to) await competingDirectory();
    return originalRename(source, destination);
  });
  t.mock.method(fs, 'mkdir', async (path, options) => {
    if (path === to) await competingDirectory();
    return originalMkdir(path, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(migrateState(from, to), /Destination already exists/);
  assert.deepEqual(await readdir(to), []);
  assert.equal((await lstat(to)).ino, created.ino);
  assert.equal(await readFile(join(from, 'device-id'), 'utf8'), 'preserved identity');
});

test('migration preserves relative symbolic links', { skip: process.platform === 'win32' }, async (t) => {
  const { from, to } = await fixture(t);
  await writeFile(join(from, 'device-id'), 'identity');
  await symlink('device-id', join(from, 'identity-link'));
  await migrateState(from, to);
  assert.equal(await readlink(join(to, 'identity-link')), 'device-id');
  assert.equal(await readFile(join(to, 'identity-link'), 'utf8'), 'identity');
});

test('symlink aliases cannot hide a nested destination', { skip: process.platform === 'win32' }, async (t) => {
  const { base, from } = await fixture(t);
  const alias = join(base, 'alias');
  await symlink(from, alias, 'dir');
  await assert.rejects(migrateState(from, join(alias, 'quotern')), /separate directories/);
  assert.deepEqual(await readdir(from), []);
});

test('source changes during staging abort without publishing a destination', async (t) => {
  const { base, from, to } = await fixture(t);
  await writeFile(join(from, 'device-id'), 'before');
  const originalCp = fs.cp;
  t.mock.method(fs, 'cp', async (source, destination, options) => {
    await originalCp(source, destination, options);
    if (source === from) await writeFile(join(from, 'device-id'), 'after');
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(migrateState(from, to), /State changed during migration/);
  assert.equal(await readFile(join(from, 'device-id'), 'utf8'), 'after');
  assert.deepEqual(await readdir(base), ['previous-profile']);
});

test('failure writing the destination keeps the source and reports incomplete state', async (t) => {
  const { base, from, to } = await fixture(t);
  await writeFile(join(from, 'device-id'), 'preserved identity');
  const originalCp = fs.cp;
  t.mock.method(fs, 'cp', async (source, destination, options) => {
    if (destination === join(to, 'device-id')) throw new Error('simulated disk write failure');
    return originalCp(source, destination, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(migrateState(from, to), /Migration incomplete.*source is preserved/);
  assert.equal(await readFile(join(from, 'device-id'), 'utf8'), 'preserved identity');
  assert.deepEqual(await readdir(to), []);
  assert.deepEqual((await readdir(base)).sort(), ['previous-profile', 'quotern']);
});
