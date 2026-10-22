import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { refreshMetadata, verifyPlatform, assembleRelease, assertReleaseRequest } from './release-artifacts.mjs';

const version = '0.1.13';
const commit = 'a'.repeat(40);
const winFiles = ['Quotern-0.1.13-win-x64-setup.exe', 'Quotern-0.1.13-win-arm64-setup.exe', 'Quotern-0.1.13-win-x64-portable.exe', 'Quotern-0.1.13-win-arm64-portable.exe'];
const macFiles = ['Quotern-0.1.13-mac-x64.zip', 'Quotern-0.1.13-mac-arm64.zip', 'Quotern-0.1.13-mac-x64.dmg', 'Quotern-0.1.13-mac-arm64.dmg'];

async function fixture(t, platform) {
  const dir = await mkdtemp(join(tmpdir(), 'quotern release fixtures '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of platform === 'win' ? winFiles : macFiles) await writeFile(join(dir, name), `fixture payload ${name}`);
  return dir;
}

async function macProof(dir) {
  await writeFile(join(dir, 'macos-verification.json'), JSON.stringify({
    schemaVersion: 1, platform: 'darwin', version, commit, teamId: 'TEAM123456', passed: true,
    checks: ['codesign', 'spctl', 'stapler', 'architecture', 'version', 'zip-extracted', 'dmg-mounted'],
    files: await Promise.all(macFiles.map(async name => ({ name, sha512: createHash('sha512').update(await readFile(join(dir, name))).digest('base64') }))),
  }));
}

test('writes one update channel containing both installers and excludes portable executables', async t => {
  const dir = await fixture(t, 'win');
  await refreshMetadata({ dir, platform: 'win', version });
  const info = yaml.load(await readFile(join(dir, 'latest.yml'), 'utf8'));
  assert.deepEqual(info.files.map(f => f.url), winFiles.slice(0, 2));
  assert.equal(info.path, winFiles[0]);
  const result = await verifyPlatform({ dir, platform: 'win', version, commit, writeManifest: true });
  assert.equal(result.files.length, 7);
  assert.equal(result.commit, commit);
  assert.equal((await readFile(join(dir, 'win-artifacts.json'), 'utf8')).includes('portable.exe'), true);
});

test('rejects missing architecture, unexpected installers and stale update hashes', async t => {
  const dir = await fixture(t, 'win');
  await refreshMetadata({ dir, platform: 'win', version });
  await rm(join(dir, winFiles[1]));
  await assert.rejects(verifyPlatform({ dir, platform: 'win', version, commit }), /missing|ENOENT/i);
  await writeFile(join(dir, winFiles[1]), 'restored');
  await refreshMetadata({ dir, platform: 'win', version });
  await writeFile(join(dir, 'Quotern-0.1.12-win-x64-setup.exe'), 'obsolete');
  await assert.rejects(verifyPlatform({ dir, platform: 'win', version, commit }), /unexpected/i);
  await rm(join(dir, 'Quotern-0.1.12-win-x64-setup.exe'));
  await writeFile(join(dir, winFiles[0]), 'changed after signing');
  await assert.rejects(verifyPlatform({ dir, platform: 'win', version, commit }), /hash|size/i);
});

test('detects stale blockmaps even when the update hash is refreshed independently', async t => {
  const dir = await fixture(t, 'win');
  await refreshMetadata({ dir, platform: 'win', version });
  const stale = await readFile(join(dir, `${winFiles[0]}.blockmap`));
  await writeFile(join(dir, winFiles[0]), 'final stapled bytes');
  await refreshMetadata({ dir, platform: 'win', version });
  await writeFile(join(dir, `${winFiles[0]}.blockmap`), stale);
  await assert.rejects(verifyPlatform({ dir, platform: 'win', version, commit }), /blockmap/i);
});

test('macOS metadata describes final bytes and requires matching Apple verification evidence', async t => {
  const dir = await fixture(t, 'mac');
  await refreshMetadata({ dir, platform: 'mac', version });
  await assert.rejects(verifyPlatform({ dir, platform: 'mac', version, commit }), /macos-verification|Apple/i);
  await macProof(dir);
  const manifest = await verifyPlatform({ dir, platform: 'mac', version, commit, writeManifest: true });
  assert.equal(manifest.files.length, 10);
  await writeFile(join(dir, macFiles[2]), 'DMG stapled after verification');
  await refreshMetadata({ dir, platform: 'mac', version });
  await assert.rejects(verifyPlatform({ dir, platform: 'mac', version, commit }), /evidence|proof|verified/i);
});

test('refuses path traversal in update metadata and uses the prerelease channel', async t => {
  const dir = await fixture(t, 'win');
  await refreshMetadata({ dir, platform: 'win', version });
  const info = yaml.load(await readFile(join(dir, 'latest.yml'), 'utf8'));
  info.files[0].url = '../other.exe';
  await writeFile(join(dir, 'latest.yml'), yaml.dump(info));
  await assert.rejects(verifyPlatform({ dir, platform: 'win', version, commit }), /metadata|URL|unexpected/i);
  const beta = await fixture(t, 'win');
  for (const name of winFiles) {
    await copyFile(join(beta, name), join(beta, name.replace('0.1.13', '0.1.14-beta.1')));
    await rm(join(beta, name));
  }
  await refreshMetadata({ dir: beta, platform: 'win', version: '0.1.14-beta.1' });
  assert.equal(yaml.load(await readFile(join(beta, 'beta.yml'), 'utf8')).version, '0.1.14-beta.1');
  // PrivateGitHubProvider 6.8.9 always requests the default channel, even for prereleases.
  assert.deepEqual(await readFile(join(beta, 'latest.yml')), await readFile(join(beta, 'beta.yml')));
  await verifyPlatform({ dir: beta, platform: 'win', version: '0.1.14-beta.1', commit });
  await writeFile(join(beta, 'latest.yml'), 'stale private feed');
  await assert.rejects(verifyPlatform({ dir: beta, platform: 'win', version: '0.1.14-beta.1', commit }), /alias|channel/i);
});

test('assembly requires both platforms and a committed source archive from the same commit', async t => {
  const input = await mkdtemp(join(tmpdir(), 'quotern release assembly '));
  t.after(() => rm(input, { recursive: true, force: true }));
  const win = await fixture(t, 'win');
  const mac = await fixture(t, 'mac');
  await refreshMetadata({ dir: win, platform: 'win', version });
  await refreshMetadata({ dir: mac, platform: 'mac', version });
  await macProof(mac);
  const w = await verifyPlatform({ dir: win, platform: 'win', version, commit, writeManifest: true });
  const m = await verifyPlatform({ dir: mac, platform: 'mac', version, commit, writeManifest: true });
  for (const [source, manifest] of [[win, w], [mac, m]]) {
    const target = join(input, manifest.platform);
    await mkdir(target);
    for (const file of manifest.files) await copyFile(join(source, file.name), join(target, file.name));
    await copyFile(join(source, `${manifest.platform}-artifacts.json`), join(target, `${manifest.platform}-artifacts.json`));
  }
  const output = join(input, 'assembled');
  await assert.rejects(assembleRelease({ input, output, version, commit }), /source/i);
  await writeFile(join(input, 'source-archive.json'), JSON.stringify({ status: 'passed', mode: 'ref', version, commit: 'b'.repeat(40), archiveSha256: 'c'.repeat(64) }));
  await assert.rejects(assembleRelease({ input, output, version, commit }), /commit/i);
  await writeFile(join(input, 'source-archive.json'), JSON.stringify({ status: 'passed', mode: 'ref', version, commit, archiveSha256: 'c'.repeat(64) }));
  const result = await assembleRelease({ input, output, version, commit });
  assert.equal(result.assets.filter(name => /\.(exe|dmg|zip)$/.test(name)).length, 8);
  assert.ok(result.assets.includes('checksums-sha256.txt'));
  await writeFile(join(input, 'win', winFiles[0]), 'changed after platform verification');
  await assert.rejects(assembleRelease({ input, output: join(input, 'another'), version, commit }), /hash|size/i);
});

test('publishing is explicit, requires a matching version tag, and rejects a dirty checkout', () => {
  assert.doesNotThrow(() => assertReleaseRequest({ version, commit, ref: 'refs/heads/main', publish: false, dirty: true }));
  assert.throws(() => assertReleaseRequest({ version, commit, ref: 'refs/heads/main', publish: true, dirty: false }), /tag/i);
  assert.throws(() => assertReleaseRequest({ version, commit, ref: 'refs/tags/v0.1.12', publish: true, dirty: false }), /version|tag/i);
  assert.throws(() => assertReleaseRequest({ version, commit, ref: 'refs/tags/v0.1.13', publish: true, dirty: true }), /clean|dirty/i);
  assert.doesNotThrow(() => assertReleaseRequest({ version, commit, ref: 'refs/tags/v0.1.13', publish: true, dirty: false }));
});
