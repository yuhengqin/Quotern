#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { assertMacosProof, macosReleasePolicy } from './macos-release-policy.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));

export function releaseLayout(version, platform, macosMode = 'signed') {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  if (!['win', 'mac'].includes(platform)) throw new Error(`Unsupported release platform: ${platform}`);
  // Current clients use beta for all prereleases. The private GitHub provider always asks for latest.
  const channel = version.includes('-') ? 'beta' : 'latest';
  const prefix = `Quotern-${version}`;
  const updates = platform === 'win'
    ? ['x64', 'arm64'].map(arch => `${prefix}-win-${arch}-setup.exe`)
    : ['zip', 'dmg'].flatMap(ext => ['x64', 'arm64'].map(arch => `${prefix}-mac-${arch}.${ext}`));
  const downloads = platform === 'win' ? [...updates, ...['x64', 'arm64'].map(arch => `${prefix}-win-${arch}-portable.exe`)] : updates;
  const suffix = `${platform === 'mac' ? '-mac' : ''}.yml`;
  if (platform === 'mac' && macosReleasePolicy(macosMode).updatePolicy === 'manual') return { updates: [], downloads, metadata: null, metadataFiles: [] };
  return { updates, downloads, metadata: `${channel}${suffix}`, metadataFiles: [...new Set([`${channel}${suffix}`, `latest${suffix}`])] };
}

export async function hashFile(file, algorithm = 'sha512', encoding = 'base64') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function buildBlockmap(file, output) {
  // Use the locked builder's blockmap implementation so updater chunking stays compatible.
  const builder = createRequire(require.resolve('electron-builder/package.json'));
  const lib = createRequire(builder.resolve('app-builder-lib/package.json'));
  const { buildBlockMap } = lib('./out/targets/blockmap/blockmap.js');
  return buildBlockMap(file, 'gzip', output);
}

async function requiredFile(dir, name) {
  if (basename(name) !== name || /[\\/]/.test(name)) throw new Error(`Unsafe artifact name: ${name}`);
  const file = join(dir, name);
  const info = await stat(file).catch(() => { throw new Error(`Missing release artifact: ${name}`); });
  if (!info.isFile() || info.size === 0) throw new Error(`Empty release artifact: ${name}`);
  return { name, size: info.size, sha512: await hashFile(file), sha256: await hashFile(file, 'sha256', 'hex') };
}

function isMacUpdaterFile(name) {
  return /-mac\.yml$/.test(name) || /^Quotern-.*-mac-.*\.(zip|dmg)\.blockmap$/.test(name);
}

export async function refreshMetadata({ dir, platform, version, macosMode = 'signed' }) {
  const layout = releaseLayout(version, platform, macosMode);
  if (platform === 'mac' && macosMode === 'adhoc') {
    // Builder may emit automatic-update files even with publishing disabled. Never ship these.
    for (const name of await readdir(dir)) if (isMacUpdaterFile(name)) await rm(join(dir, name));
    return;
  }
  const files = [];
  for (const name of layout.updates) {
    await requiredFile(dir, name);
    console.log(`Refreshing final blockmap: ${name}`);
    const info = await buildBlockmap(join(dir, name), join(dir, `${name}.blockmap`));
    files.push({ url: name, sha512: info.sha512, size: info.size });
  }
  const metadata = yaml.dump({ version, files, path: files[0].url, sha512: files[0].sha512, releaseDate: new Date().toISOString() });
  for (const name of layout.metadataFiles) await writeFile(join(dir, name), metadata);
}

async function checkMacProof(dir, version, commit, downloads, mode) {
  const proof = await readJson(join(dir, 'macos-verification.json')).catch(() => { throw new Error('Missing macos-verification.json Apple verification evidence'); });
  assertMacosProof(proof, { mode, version, commit });
  if (!Array.isArray(proof.files) || proof.files.length !== downloads.length || new Set(proof.files.map(f => f.name)).size !== downloads.length) throw new Error('Incomplete macOS verified file inventory');
  for (const name of downloads) {
    const file = await requiredFile(dir, name);
    if (proof.files.find(f => f.name === name)?.sha512 !== file.sha512) throw new Error(`macOS proof does not describe the verified final file: ${name}`);
  }
}

export async function verifyPlatform({ dir, platform, version, commit, macosMode = 'signed', writeManifest = false }) {
  if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) throw new Error('Release commit must be a full Git commit ID');
  const layout = releaseLayout(version, platform, macosMode);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && /^Quotern-.*\.(exe|zip|dmg)$/.test(entry.name) && !layout.downloads.includes(entry.name)) throw new Error(`Unexpected release artifact: ${entry.name}`);
    if (platform === 'mac' && macosMode === 'adhoc' && isMacUpdaterFile(entry.name)) throw new Error('Manual macOS releases must not contain an automatic update feed/blockmap');
  }
  const downloadInfo = await Promise.all(layout.downloads.map(name => requiredFile(dir, name)));
  if (layout.metadataFiles.length) {
    const metadata = await readFile(join(dir, layout.metadata), 'utf8');
    for (const name of layout.metadataFiles) {
      if (await readFile(join(dir, name), 'utf8') !== metadata) throw new Error(`Stale private updater channel alias: ${name}`);
    }
    const info = yaml.load(metadata);
    const urls = info?.files?.map(file => file.url);
    if (info?.version !== version || !Array.isArray(urls) || urls.length !== layout.updates.length || new Set(urls).size !== urls.length || urls.some(url => !layout.updates.includes(url))) throw new Error('Unexpected update metadata version, inventory or URL');
    const temporary = await mkdtemp(join(tmpdir(), 'quotern-blockmap-verify-'));
    try {
      for (const file of info.files) {
        const actual = downloadInfo.find(f => f.name === file.url);
        if (file.size !== actual.size || file.sha512 !== actual.sha512) throw new Error(`Update size/hash mismatch: ${file.url}`);
        const expected = join(temporary, `${file.url}.blockmap`);
        await buildBlockmap(join(dir, file.url), expected);
        const recorded = await readFile(join(dir, `${file.url}.blockmap`));
        if (!recorded.equals(await readFile(expected))) throw new Error(`Stale blockmap: ${file.url}`);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    const legacy = downloadInfo.find(f => f.name === info.path);
    if (!layout.updates.includes(info.path) || info.sha512 !== legacy?.sha512) throw new Error('Invalid legacy update path/hash');
  }
  if (platform === 'mac') await checkMacProof(dir, version, commit, layout.downloads, macosMode);
  const names = [...layout.downloads, ...layout.updates.map(name => `${name}.blockmap`), ...layout.metadataFiles, ...(platform === 'mac' ? ['macos-verification.json'] : [])];
  const manifest = { schemaVersion: 1, platform, version, commit, ...(platform === 'mac' ? { macosMode, updatePolicy: macosReleasePolicy(macosMode).updatePolicy } : {}), files: await Promise.all(names.map(name => requiredFile(dir, name))) };
  if (writeManifest) await writeFile(join(dir, `${platform}-artifacts.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function findInput(input, filename, folders) {
  const found = [];
  for (const folder of ['', ...folders]) {
    const candidate = join(input, folder, filename);
    if (await access(candidate).then(() => true, () => false)) found.push(candidate);
  }
  if (found.length !== 1) throw new Error(`Expected exactly one ${filename}; found ${found.length}`);
  return found[0];
}

export async function assembleRelease({ input, output, version, commit, macosMode = 'signed' }) {
  const policy = macosReleasePolicy(macosMode);
  const verified = [];
  for (const platform of ['win', 'mac']) {
    const manifestPath = await findInput(input, `${platform}-artifacts.json`, [platform, `desktop-${platform}`]);
    const manifest = await readJson(manifestPath);
    if (manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.version !== version || manifest.commit !== commit) throw new Error(`${platform} version/commit mismatch`);
    if (platform === 'mac' && (manifest.macosMode !== macosMode || manifest.updatePolicy !== policy.updatePolicy)) throw new Error('macOS manifest release mode/policy mismatch');
    const current = await verifyPlatform({ dir: dirname(manifestPath), platform, version, commit, macosMode });
    if (!Array.isArray(manifest.files) || JSON.stringify(manifest.files) !== JSON.stringify(current.files)) throw new Error(`${platform} manifest file size/hash mismatch`);
    verified.push({ dir: dirname(manifestPath), manifest });
  }
  const sourcePath = await findInput(input, 'source-archive.json', ['source-archive']);
  const source = await readJson(sourcePath);
  if (source.status !== 'passed' || source.mode !== 'ref' || source.version !== version || source.commit !== commit || !/^[0-9a-f]{64}$/i.test(source.archiveSha256 ?? '')) throw new Error('Source archive must be verified at the same version/commit');
  await mkdir(output);
  const names = [];
  for (const { dir, manifest } of verified) {
    for (const file of manifest.files) {
      if (names.includes(file.name)) throw new Error(`Duplicate assembled filename: ${file.name}`);
      await copyFile(join(dir, file.name), join(output, file.name));
      names.push(file.name);
    }
    const name = `${manifest.platform}-artifacts.json`;
    await copyFile(join(dir, name), join(output, name));
    names.push(name);
  }
  await copyFile(sourcePath, join(output, 'source-archive.json'));
  names.push('source-archive.json');
  const checksums = await Promise.all(names.sort().map(async name => `${await hashFile(join(output, name), 'sha256', 'hex')}  ${name}`));
  await writeFile(join(output, 'checksums-sha256.txt'), `${checksums.join('\n')}\n`);
  names.push('checksums-sha256.txt');
  return { version, commit, macosMode, assets: names };
}

export function assertReleaseRequest({ version, commit, ref, publish = false, dirty = false }) {
  if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) throw new Error('Invalid source commit');
  if (ref?.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`) throw new Error('Release tag must match the Desktop package version');
  if (publish && ref !== `refs/tags/v${version}`) throw new Error('Draft publication requires a matching version tag');
  if (publish && dirty) throw new Error('Draft publication requires a clean checkout');
}

export async function requireReleaseNotes({ root = ROOT, version }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  const file = join(root, 'docs', 'release-notes', `v${version}.md`);
  const notes = await readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new Error(`Missing release notes: docs/release-notes/v${version}.md`);
    throw error;
  });
  if (!notes.trim()) throw new Error(`Release notes are empty: ${file}`);
  return file;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    dir: { type: 'string' }, platform: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' },
    version: { type: 'string' }, commit: { type: 'string' }, ref: { type: 'string' }, publish: { type: 'boolean', default: false },
    'github-output': { type: 'string' },
    'macos-mode': { type: 'string' },
  } });
  const version = values.version ?? (await readJson(join(ROOT, 'apps/desktop/package.json'))).version;
  const commit = values.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const macosMode = values['macos-mode'] ?? (positionals[0] === 'preflight' ? 'adhoc' : 'signed');
  macosReleasePolicy(macosMode);
  if (positionals[0] === 'preflight') {
    const ref = values.ref ?? process.env.GITHUB_REF ?? '';
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
    assertReleaseRequest({ version, commit, ref, publish: values.publish, dirty });
    if (values.publish) {
      const taggedCommit = execFileSync('git', ['rev-parse', `${ref}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
      if (taggedCommit !== commit) throw new Error('Tag does not point at the checked-out source commit');
      await requireReleaseNotes({ version });
    }
    if (values['github-output']) await writeFile(values['github-output'], `version=${version}\ncommit=${commit}\ntag=v${version}\nmacos-mode=${macosMode}\n`, { flag: 'a' });
    console.log(JSON.stringify({ version, commit, ref, macosMode, publish: values.publish }));
  } else if (positionals[0] === 'refresh') {
    await refreshMetadata({ dir: resolve(values.dir ?? join(ROOT, 'apps/desktop/release', version)), platform: values.platform, version, macosMode });
  } else if (positionals[0] === 'verify') {
    const dir = resolve(values.dir ?? join(ROOT, 'apps/desktop/release', version));
    const result = await verifyPlatform({ dir, platform: values.platform, version, commit, macosMode, writeManifest: true });
    console.log(`Verified ${result.files.length} ${values.platform} release files at ${commit}`);
  } else if (positionals[0] === 'assemble') {
    console.log(JSON.stringify(await assembleRelease({ input: resolve(values.input), output: resolve(values.output), version, commit, macosMode }), null, 2));
  } else {
    throw new Error('Usage: release-artifacts.mjs <preflight|refresh|verify|assemble> [--platform win|mac] [--dir path]');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
