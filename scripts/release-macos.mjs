#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import yaml from 'js-yaml';
import { hashFile, refreshMetadata, releaseLayout, verifyPlatform } from './release-artifacts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const execute = promisify(execFile);
const pause = ms => new Promise(accept => setTimeout(accept, ms));

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

async function verifyApp(app, architecture, version, teamId) {
  console.log(`Verifying ${architecture} app: ${app}`);
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const identity = await run('codesign', ['--display', '--verbose=4', app]);
  assertAppIdentity(identity.stderr, teamId);
  await run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  await run('xcrun', ['stapler', 'validate', app]);
  const plist = join(app, 'Contents/Info.plist');
  const readPlist = key => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).then(result => result.stdout.trim());
  if (await readPlist('CFBundleShortVersionString') !== version) throw new Error('App bundle version does not match the release');
  const executable = await readPlist('CFBundleExecutable');
  if (!/^[\w .-]+$/.test(executable)) throw new Error('Unsafe bundle executable name');
  assertArchitecture((await run('lipo', ['-archs', join(app, 'Contents/MacOS', executable)])).stdout, architecture);
  await verifyNativeArchitecture({ modules: join(app, 'Contents/Resources/app.asar.unpacked/node_modules'), architecture,
    inspect: async file => (await run('lipo', ['-archs', file])).stdout });
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

export async function releaseMacos({ dir, skipBuild = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS release acceptance must run on macOS with Apple command-line tools');
  const credentials = appleCredentials(process.env);
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' || process.env.CSC_NAME === '-') throw new Error('Release signing identity may not be disabled or ad hoc');
  const config = yaml.load(await readFile(join(DESKTOP, 'electron-builder.yml'), 'utf8'));
  if (config.mac?.forceCodeSigning !== true || config.mac?.type !== 'distribution' || config.mac?.notarize !== true || config.dmg?.sign !== true) throw new Error('Release configuration must require Developer ID signing and notarization');
  const identities = (await run('security', ['find-identity', '-v', '-p', 'codesigning', ...(process.env.CSC_KEYCHAIN ? [process.env.CSC_KEYCHAIN] : [])])).stdout;
  if (!identities.split('\n').some(line => line.includes('Developer ID Application:') && line.includes(`(${credentials.teamId})`))) throw new Error('No valid Developer ID Application certificate for APPLE_TEAM_ID');
  const version = JSON.parse(await readFile(join(DESKTOP, 'package.json'), 'utf8')).version;
  const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
  dir = resolve(dir ?? join(DESKTOP, 'release', version));
  await mkdir(dir, { recursive: true });
  // A failed rerun must not leave an earlier success report behind.
  await rm(join(dir, 'macos-verification.json'), { force: true });
  await rm(join(dir, 'mac-artifacts.json'), { force: true });
  if (!skipBuild) {
    const require = createRequire(join(DESKTOP, 'package.json'));
    const builder = join(dirname(require.resolve('electron-builder/package.json')), 'out/cli/cli.js');
    await run(process.execPath, [builder, '--mac', '--publish', 'never', `--config.directories.output=${dir}`], { cwd: DESKTOP, env: process.env });
  }
  for (const architecture of ['x64', 'arm64']) {
    await verifyApp(join(dir, architecture === 'x64' ? 'mac/Quotern.app' : 'mac-arm64/Quotern.app'), architecture, version, credentials.teamId);
  }
  const temporary = await mkdtemp(join(tmpdir(), 'quotern-macos-verify-'));
  const submissions = {};
  try {
    for (const architecture of ['x64', 'arm64']) {
      const zip = join(dir, `Quotern-${version}-mac-${architecture}.zip`);
      const extracted = join(temporary, architecture);
      await mkdir(extracted);
      await run('ditto', ['-x', '-k', zip, extracted]);
      await verifyApp(join(extracted, 'Quotern.app'), architecture, version, credentials.teamId);
      const dmg = join(dir, `Quotern-${version}-mac-${architecture}.dmg`);
      await run('codesign', ['--verify', '--strict', '--verbose=2', dmg]);
      assertAppIdentity((await run('codesign', ['--display', '--verbose=4', dmg])).stderr, credentials.teamId, false);
      submissions[architecture] = await notarizeDmg({ file: dmg, credentials });
      await run('hdiutil', ['verify', dmg]);
      await run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
      const mount = join(temporary, `mount-${architecture}`);
      await mkdir(mount);
      let mounted = false;
      try {
        await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
        mounted = true;
        await verifyApp(join(mount, 'Quotern.app'), architecture, version, credentials.teamId);
      } finally {
        if (mounted) await run('hdiutil', ['detach', mount]);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const files = await Promise.all(releaseLayout(version, 'mac').downloads.map(async name => ({ name, sha512: await hashFile(join(dir, name)) })));
  await writeFile(join(dir, 'macos-verification.json'), `${JSON.stringify({ schemaVersion: 1, platform: 'darwin', passed: true, version, commit, teamId: credentials.teamId, checks: ['codesign', 'spctl', 'stapler', 'architecture', 'version', 'zip-extracted', 'dmg-mounted'], submissions, files }, null, 2)}\n`);
  // Stapling changes DMG bytes. Generate metadata and blockmaps only after final acceptance.
  await refreshMetadata({ dir, platform: 'mac', version });
  await verifyPlatform({ dir, platform: 'mac', version, commit, writeManifest: true });
  console.log(`Verified macOS release files without uploading: ${dir}`);
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, 'skip-build': { type: 'boolean', default: false } } });
  await releaseMacos({ dir: values.dir, skipBuild: values['skip-build'] });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
