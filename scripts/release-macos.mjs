#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import yaml from 'js-yaml';
import { hashFile, refreshMetadata, releaseLayout, verifyPlatform } from './release-artifacts.mjs';
import { macosBuilderArgs, macosBuildEnvironment, macosReleasePolicy } from './macos-release-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const execute = promisify(execFile);
const pause = ms => new Promise(accept => setTimeout(accept, ms));
const appRequire = createRequire(join(DESKTOP, 'package.json'));
const builderRequire = createRequire(appRequire.resolve('electron-builder/package.json'));
const libRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));

// Never print these arguments: the Apple-ID route contains an app-specific password.
export function appleCredentials(env) {
  const teamId = env.APPLE_TEAM_ID;
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) throw new Error('APPLE_TEAM_ID must be the expected 10-character signing team');
  const routes = [Boolean(env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD), Boolean(env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER), Boolean(env.APPLE_KEYCHAIN_PROFILE)];
  if (routes.filter(Boolean).length !== 1) throw new Error('Provide exactly one complete set of Apple notarization credentials');
  if (routes[0]) {
    if (!env.APPLE_ID || !env.APPLE_APP_SPECIFIC_PASSWORD) throw new Error('Apple ID credentials must be complete');
    return { teamId, args: ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', teamId] };
  }
  if (routes[1]) {
    if (!env.APPLE_API_KEY || !env.APPLE_API_KEY_ID || !env.APPLE_API_ISSUER) throw new Error('App Store Connect API credentials must be complete');
    return { teamId, args: ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER] };
  }
  return { teamId, args: ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE, ...(env.APPLE_KEYCHAIN ? ['--keychain', env.APPLE_KEYCHAIN] : [])] };
}

export function assertAppIdentity(details, teamId, hardened = true) {
  const authority = details.split(/\r?\n/).find(line => line.startsWith('Authority='));
  if (!authority?.startsWith('Authority=Developer ID Application:') || !authority.endsWith(`(${teamId})`)) throw new Error('Unexpected Developer ID signing identity/team');
  if (!details.split(/\r?\n/).includes(`TeamIdentifier=${teamId}`)) throw new Error('Unexpected signing team');
  if (hardened && !/flags=.*\(.*\bruntime\b.*\)/.test(details)) throw new Error('Missing hardened runtime');
}

export function assertArchitecture(details, architecture) {
  const expected = architecture === 'x64' ? 'x86_64' : 'arm64';
  if (details.trim() !== expected) throw new Error(`Unexpected architecture: expected ${expected}, got ${details.trim()}`);
}

export function assertAdhocIdentity(details) {
  const lines = details.split(/\r?\n/);
  if (!lines.includes('Signature=adhoc') || lines.some(line => line.startsWith('Authority='))) throw new Error('Expected an ad-hoc signature without a certificate identity');
  if (lines.some(line => line.startsWith('TeamIdentifier=') && line !== 'TeamIdentifier=not set')) throw new Error('Unexpected ad-hoc signing team');
}

async function run(command, args, options = {}) {
  try {
    return await execute(command, args, { maxBuffer: 16 * 1024 * 1024, ...options });
  } catch (error) {
    // execFile's default error text includes arguments, which may contain credentials.
    throw new Error(`${command} failed (${error.code ?? 'unknown'}): ${error.stderr || error.stdout || error.cause?.message || 'command failed'}`);
  }
}

export async function notarizeDmg({ run: command = run, file, credentials, pause: delay = pause }) {
  console.log(`Submitting DMG for Apple notarization: ${file}`);
  const submission = JSON.parse((await command('xcrun', ['notarytool', 'submit', file, ...credentials.args, '--no-progress', '--output-format', 'json'])).stdout);
  if (!submission.id) throw new Error('Apple did not return a notarization submission ID');
  let status = submission.status;
  if (status && !['Accepted', 'In Progress', 'Uploaded'].includes(status)) throw new Error(`Apple notarization ${submission.id}: ${status}`);
  for (let attempt = 0; status !== 'Accepted'; attempt++) {
    try {
      const result = JSON.parse((await command('xcrun', ['notarytool', 'wait', submission.id, ...credentials.args, '--timeout', '20m', '--output-format', 'json'])).stdout);
      status = result.status;
      if (status !== 'Accepted') throw new Error(`Apple notarization ${submission.id}: ${status}`);
    } catch (error) {
      const transient = /timed?\s*out|timeout|503|502|504|network|connection|service unavailable/i.test(error.message);
      if (attempt >= 2 || /Invalid|Rejected|401|403|Unauthorized/i.test(error.message) || !transient) throw error;
      console.log(`Waiting again for existing notarization submission ${submission.id}`);
      await delay(5000 * (attempt + 1));
    }
  }
  await command('xcrun', ['stapler', 'staple', file]);
  await command('xcrun', ['stapler', 'validate', file]);
  return submission.id;
}

async function verifyApp(app, architecture, version, mode, credentials, command) {
  console.log(`Verifying ${architecture} app: ${app}`);
  await command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const identity = await command('codesign', ['--display', '--verbose=4', app]);
  if (mode === 'signed') {
    assertAppIdentity(identity.stderr, credentials.teamId);
    await command('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
    await command('xcrun', ['stapler', 'validate', app]);
  } else {
    assertAdhocIdentity(identity.stderr);
    await verifyNestedAdhocSignatures(app, command);
  }
  const { extractFile, uncache } = libRequire('@electron/asar');
  const archive = join(app, 'Contents/Resources/app.asar');
  uncache(archive);
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  if (metadata.quoternMacosReleaseMode !== mode || metadata.version !== version) throw new Error('Packaged macOS mode marker/version mismatch');
  const plist = join(app, 'Contents/Info.plist');
  const readPlist = key => command('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).then(result => result.stdout.trim());
  if (await readPlist('CFBundleShortVersionString') !== version) throw new Error('App bundle version does not match the release');
  const executable = await readPlist('CFBundleExecutable');
  if (!/^[\w .-]+$/.test(executable)) throw new Error('Unsafe bundle executable name');
  assertArchitecture((await command('lipo', ['-archs', join(app, 'Contents/MacOS', executable)])).stdout, architecture);
  await verifyNativeArchitecture({ modules: join(app, 'Contents/Resources/app.asar.unpacked/node_modules'), architecture,
    inspect: async file => (await command('lipo', ['-archs', file])).stdout });
}

async function verifyNestedAdhocSignatures(directory, command) {
  const machO = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    let signedCode = entry.isDirectory() && /\.(app|framework)$/.test(entry.name);
    if (entry.isFile()) {
      const handle = await open(file, 'r');
      try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await handle.read(header, 0, 4, 0);
        signedCode = bytesRead === 4 && machO.has(header.toString('hex'));
      } finally { await handle.close(); }
    }
    if (signedCode) assertAdhocIdentity((await command('codesign', ['--display', '--verbose=4', file])).stderr);
    if (entry.isDirectory()) await verifyNestedAdhocSignatures(file, command);
  }
}

export async function verifyNativeArchitecture({ modules, architecture, inspect }) {
  // The staging closure contains both optional CPU packages. Sharp loads only this target's pair.
  let addons = 0;
  let libraries = 0;
  async function nativeFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await nativeFiles(file);
      else if (entry.isFile() && /\.(node|dylib)$/.test(entry.name)) {
        assertArchitecture(await inspect(file), architecture);
        if (entry.name.endsWith('.node')) addons++;
        else libraries++;
      }
    }
  }
  await nativeFiles(join(modules, `@img/sharp-darwin-${architecture}/lib`));
  await nativeFiles(join(modules, `@img/sharp-libvips-darwin-${architecture}/lib`));
  if (!addons) throw new Error('No packaged native decoder found');
  if (!libraries) throw new Error('No packaged libvips library found');
}

export async function releaseMacos({ dir, skipBuild = false, mode = 'adhoc', arch, buildOnly = false } = {}) {
  macosReleasePolicy(mode);
  if (arch && (!['arm64', 'x64'].includes(arch) || !buildOnly)) throw new Error('Single-architecture builds require --build-only and --arch arm64|x64');
  if (skipBuild && buildOnly) throw new Error('--skip-build and --build-only cannot be combined');
  if (process.platform !== 'darwin') throw new Error('macOS release acceptance must run on macOS with Apple command-line tools');
  const credentials = mode === 'signed' ? appleCredentials(process.env) : undefined;
  if (mode === 'signed' && (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' || process.env.CSC_NAME === '-')) throw new Error('Release signing identity may not be disabled or ad hoc');
  const config = yaml.load(await readFile(join(DESKTOP, 'electron-builder.yml'), 'utf8'));
  if (config.mac?.forceCodeSigning !== true || config.mac?.type !== 'distribution' || config.mac?.notarize !== true || config.dmg?.sign !== true) throw new Error('Release configuration must require Developer ID signing and notarization');
  if (mode === 'signed') {
    const identities = (await run('security', ['find-identity', '-v', '-p', 'codesigning', ...(process.env.CSC_KEYCHAIN ? [process.env.CSC_KEYCHAIN] : [])])).stdout;
    if (!identities.split('\n').some(line => line.includes('Developer ID Application:') && line.includes(`(${credentials.teamId})`))) throw new Error('No valid Developer ID Application certificate for APPLE_TEAM_ID');
  }
  const version = JSON.parse(await readFile(join(DESKTOP, 'package.json'), 'utf8')).version;
  const commit = buildOnly ? undefined : (await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
  dir = resolve(dir ?? join(DESKTOP, 'release', version, `mac-${mode}${arch ? `-${arch}` : ''}`));
  await mkdir(dir, { recursive: true });
  // A failed rerun must not leave an earlier success report behind.
  await rm(join(dir, 'macos-verification.json'), { force: true });
  await rm(join(dir, 'mac-artifacts.json'), { force: true });
  if (!skipBuild) {
    const builder = join(dirname(appRequire.resolve('electron-builder/package.json')), 'out/cli/cli.js');
    const args = macosBuilderArgs(mode, dir).filter(value => !arch || !['--arm64', '--x64'].includes(value));
    if (arch) args.push(`--${arch}`);
    const build = env => run(process.execPath, [builder, ...args], { cwd: DESKTOP, env });
    if (mode === 'adhoc') await withAdhocKeychain(build);
    else await build(macosBuildEnvironment(process.env, mode));
  }
  if (buildOnly) { console.log(`Built ${mode} macOS packages without uploading: ${dir}`); return; }
  await verifyMacosArtifacts({ dir, version, commit, mode, credentials });
}

async function withAdhocKeychain(build) {
  const temporary = await mkdtemp(join(tmpdir(), 'quotern-adhoc-keychain-'));
  const keychain = join(temporary, 'empty.keychain-db');
  const password = randomBytes(32).toString('hex');
  let created = false;
  try {
    // An explicit "-" can match a certificate containing a hyphen in builder 26.15.3.
    // Restrict its identity search to an owned empty keychain without changing the search list.
    await run('security', ['create-keychain', '-p', password, keychain]);
    created = true;
    await run('security', ['unlock-keychain', '-p', password, keychain]);
    await build(macosBuildEnvironment(process.env, 'adhoc', keychain));
  } finally {
    try { if (created) await run('security', ['delete-keychain', keychain]); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

export async function verifyMacosArtifacts({ dir, version, commit, mode, credentials, command = run }) {
  const policy = macosReleasePolicy(mode);
  if (mode === 'signed' && !credentials?.teamId) throw new Error('Signed verification requires Apple signing credentials');
  await rm(join(dir, 'macos-verification.json'), { force: true });
  await rm(join(dir, 'mac-artifacts.json'), { force: true });
  for (const architecture of ['x64', 'arm64']) {
    await verifyApp(join(dir, architecture === 'x64' ? 'mac/Quotern.app' : 'mac-arm64/Quotern.app'), architecture, version, mode, credentials, command);
  }
  const temporary = await mkdtemp(join(tmpdir(), 'quotern-macos-verify-'));
  const submissions = {};
  try {
    for (const architecture of ['x64', 'arm64']) {
      const zip = join(dir, `Quotern-${version}-mac-${architecture}.zip`);
      const extracted = join(temporary, architecture);
      await mkdir(extracted);
      await command('ditto', ['-x', '-k', zip, extracted]);
      await verifyApp(join(extracted, 'Quotern.app'), architecture, version, mode, credentials, command);
      const dmg = join(dir, `Quotern-${version}-mac-${architecture}.dmg`);
      if (mode === 'signed') {
        await command('codesign', ['--verify', '--strict', '--verbose=2', dmg]);
        assertAppIdentity((await command('codesign', ['--display', '--verbose=4', dmg])).stderr, credentials.teamId, false);
        submissions[architecture] = await notarizeDmg({ file: dmg, credentials, run: command });
        await command('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
      }
      await command('hdiutil', ['verify', dmg]);
      const mount = join(temporary, `mount-${architecture}`);
      await mkdir(mount);
      let mounted = false;
      try {
        await command('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
        mounted = true;
        await verifyApp(join(mount, 'Quotern.app'), architecture, version, mode, credentials, command);
      } finally {
        if (mounted) await command('hdiutil', ['detach', mount]);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const files = await Promise.all(releaseLayout(version, 'mac', mode).downloads.map(async name => ({ name, sha512: await hashFile(join(dir, name)) })));
  await writeFile(join(dir, 'macos-verification.json'), `${JSON.stringify({ schemaVersion: 2, platform: 'darwin', passed: true, version, commit, mode, updatePolicy: policy.updatePolicy, notarized: policy.notarized, teamId: credentials?.teamId ?? null, checks: policy.checks, submissions, files }, null, 2)}\n`);
  // Stapling changes DMG bytes. Generate metadata and blockmaps only after final acceptance.
  await refreshMetadata({ dir, platform: 'mac', version, macosMode: mode });
  await verifyPlatform({ dir, platform: 'mac', version, commit, macosMode: mode, writeManifest: true });
  console.log(`Verified ${mode} macOS release files without uploading: ${dir}`);
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, 'skip-build': { type: 'boolean', default: false }, mode: { type: 'string', default: 'adhoc' }, arch: { type: 'string' }, 'build-only': { type: 'boolean', default: false } } });
  await releaseMacos({ dir: values.dir, skipBuild: values['skip-build'], mode: values.mode, arch: values.arch, buildOnly: values['build-only'] });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
