import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appleCredentials, assertAppIdentity, assertAdhocIdentity, assertArchitecture, notarizeDmg, verifyNativeArchitecture, verifyMacosArtifacts } from './release-macos.mjs';

const team = 'ABCDE12345';
test('ad-hoc acceptance rejects unsigned or certificate-signed code', () => {
  assertAdhocIdentity('Signature=adhoc\nTeamIdentifier=not set');
  for (const details of ['code object is not signed at all', `Authority=Developer ID Application: Test (${team})\nTeamIdentifier=${team}`, `Signature=adhoc\nTeamIdentifier=${team}`]) assert.throws(() => assertAdhocIdentity(details), /ad.hoc|team/i);
});

for (const mode of ['adhoc', 'signed']) test(`${mode} verification checks ZIP/DMG mode and only notarizes signed packages`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern adhoc verification '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
  const builder = createRequire(require.resolve('electron-builder/package.json'));
  const lib = createRequire(builder.resolve('app-builder-lib/package.json'));
  const { createPackage } = lib('@electron/asar');
  const version = '0.1.13';
  const commit = 'a'.repeat(40);
  for (const arch of ['x64', 'arm64']) {
    const app = join(directory, arch === 'x64' ? 'mac/Quotern.app' : 'mac-arm64/Quotern.app');
    const resources = join(app, 'Contents/Resources');
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
    await writeFile(join(app, 'Contents/MacOS/Quotern'), Buffer.from('cffaedfe00000000', 'hex'));
    for (const [name, file] of [[`sharp-darwin-${arch}`, 'sharp.node'], [`sharp-libvips-darwin-${arch}`, 'libvips.dylib']]) {
      const libDirectory = join(resources, 'app.asar.unpacked/node_modules/@img', name, 'lib');
      await mkdir(libDirectory, { recursive: true });
      await writeFile(join(libDirectory, file), Buffer.from('cffaedfe00000000', 'hex'));
    }
    const source = join(directory, `asar-${arch}`);
    await mkdir(source);
    await writeFile(join(source, 'package.json'), JSON.stringify({ version, quoternMacosReleaseMode: mode }));
    await createPackage(source, join(resources, 'app.asar'));
    for (const extension of ['zip', 'dmg']) await writeFile(join(directory, `Quotern-${version}-mac-${arch}.${extension}`), `fixture ${arch} ${extension}`);
  }
  const calls = [];
  const command = async (name, args) => {
    calls.push([name, ...args]);
    if (name === 'codesign') return { stdout: '', stderr: args.includes('--display') ? mode === 'adhoc' ? 'Signature=adhoc\nTeamIdentifier=not set' : `Authority=Developer ID Application: Test (${team})\nTeamIdentifier=${team}\nCodeDirectory flags=0x10000(runtime)` : '' };
    if (name === '/usr/libexec/PlistBuddy') return { stdout: args[1].includes('CFBundleExecutable') ? 'Quotern' : version };
    if (name === 'lipo') return { stdout: args.at(-1).includes('arm64') ? 'arm64' : 'x86_64' };
    if (name === 'spctl') return { stdout: '', stderr: '' };
    if (name === 'xcrun') {
      if (args.includes('submit')) return { stdout: '{"id":"fixture-submission","status":"Accepted"}' };
      if (args.includes('staple')) await writeFile(args.at(-1), `${await readFile(args.at(-1), 'utf8')}\nstapled fixture ticket`);
      return { stdout: '', stderr: '' };
    }
    if (name === 'ditto' || (name === 'hdiutil' && args.includes('attach'))) {
      const arch = args.join(' ').includes('arm64') ? 'arm64' : 'x64';
      const target = name === 'ditto' ? args.at(-1) : args[args.indexOf('-mountpoint') + 1];
      await cp(join(directory, arch === 'x64' ? 'mac/Quotern.app' : 'mac-arm64/Quotern.app'), join(target, 'Quotern.app'), { recursive: true });
    } else if (name !== 'hdiutil') throw new Error(`Unexpected command: ${name}`);
    return { stdout: '', stderr: '' };
  };
  const credentials = mode === 'signed' ? { teamId: team, args: ['--keychain-profile', 'fixture'] } : undefined;
  await verifyMacosArtifacts({ dir: directory, mode, version, commit, command, credentials });
  if (mode === 'adhoc') assert(!calls.some(call => ['xcrun', 'spctl', 'security'].includes(call[0])));
  else assert.equal(calls.filter(call => call.includes('submit')).length, 2);
  assert.equal(calls.filter(call => call.includes('attach')).length, 2);
  const proof = JSON.parse(await readFile(join(directory, 'macos-verification.json'), 'utf8'));
  assert.equal(proof.notarized, mode === 'signed');
  assert.equal(proof.updatePolicy, mode === 'signed' ? 'automatic' : 'manual');
  assert.equal(proof.checks.includes('stapler'), mode === 'signed');
  const manifest = JSON.parse(await readFile(join(directory, 'mac-artifacts.json'), 'utf8'));
  assert.equal(manifest.files.length, mode === 'signed' ? 10 : 5);
  // A valid signature must not make a mismatched app package mode acceptable.
  const source = join(directory, 'asar-x64');
  await writeFile(join(source, 'package.json'), JSON.stringify({ version, quoternMacosReleaseMode: mode === 'signed' ? 'adhoc' : 'signed' }));
  await createPackage(source, join(directory, 'mac/Quotern.app/Contents/Resources/app.asar'));
  await assert.rejects(verifyMacosArtifacts({ dir: directory, mode, version, commit, command, credentials }), /mode|marker/i);
});
test('release signing requires an expected team and one complete notarization identity', () => {
  assert.throws(() => appleCredentials({}), /TEAM/);
  assert.throws(() => appleCredentials({ APPLE_TEAM_ID: team }), /credentials/i);
  assert.throws(() => appleCredentials({ APPLE_TEAM_ID: team, APPLE_ID: 'dev@example.invalid' }), /complete/i);
  assert.deepEqual(appleCredentials({ APPLE_TEAM_ID: team, APPLE_KEYCHAIN_PROFILE: 'release' }).args, ['--keychain-profile', 'release']);
  assert.deepEqual(appleCredentials({ APPLE_TEAM_ID: team, APPLE_API_KEY: '/key.p8', APPLE_API_KEY_ID: 'KEY', APPLE_API_ISSUER: 'issuer' }).args,
    ['--key', '/key.p8', '--key-id', 'KEY', '--issuer', 'issuer']);
  assert.throws(() => appleCredentials({ APPLE_TEAM_ID: team, APPLE_KEYCHAIN_PROFILE: 'release', APPLE_ID: 'dev', APPLE_APP_SPECIFIC_PASSWORD: 'secret' }), /one/i);
});

test('ad hoc, wrong team, development certificates and missing hardened runtime fail acceptance', () => {
  const details = `Authority=Developer ID Application: Test (${team})\nTeamIdentifier=${team}\nCodeDirectory flags=0x10000(runtime)`;
  assertAppIdentity(details, team);
  for (const invalid of ['Signature=adhoc', details.replace(team, 'OTHER12345'), details.replace('Developer ID Application', 'Mac Developer'), details.replace('(runtime)', '')]) {
    assert.throws(() => assertAppIdentity(invalid, team), /identity|runtime|team/i);
  }
  assertArchitecture('x86_64', 'x64');
  assertArchitecture('arm64', 'arm64');
  assert.throws(() => assertArchitecture('x86_64 arm64', 'arm64'), /architecture/i);
  assert.throws(() => assertArchitecture('x86_64', 'arm64'), /architecture/i);
});

test('notarization retries the known submission instead of uploading again, then staples', async () => {
  const calls = [];
  let waits = 0;
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args.includes('submit')) return { stdout: '{"id":"submission-1","status":"In Progress"}' };
    if (args.includes('wait')) {
      if (++waits === 1) throw new Error('HTTP 503 Service Unavailable');
      return { stdout: '{"id":"submission-1","status":"Accepted"}' };
    }
    return { stdout: '' };
  };
  await notarizeDmg({ run, file: '/tmp/app.dmg', credentials: { args: ['--keychain-profile', 'release'] }, pause: async () => {} });
  assert.equal(calls.filter(call => call.includes('submit')).length, 1);
  assert.equal(calls.filter(call => call.includes('wait')).length, 2);
  assert(calls.filter(call => call.includes('wait')).every(call => call.includes('submission-1')));
  assert(calls.some(call => call.includes('staple')));
});

test('rejected or unauthorized notarization never staples or retries', async () => {
  for (const reason of ['Invalid', 'HTTP 401 Unauthorized']) {
    const calls = [];
    const run = async (command, args) => {
      calls.push(args);
      if (reason.startsWith('HTTP')) throw new Error(reason);
      return { stdout: JSON.stringify({ id: 'bad', status: reason }) };
    };
    await assert.rejects(notarizeDmg({ run, file: '/tmp/app.dmg', credentials: { args: [] }, pause: async () => {} }), /Invalid|401/);
    assert.equal(calls.length, 1);
  }
});

test('native verification follows the selected Sharp closure in dual-architecture staging', async t => {
  const modules = await mkdtemp(join(tmpdir(), 'quotern native architectures '));
  t.after(() => rm(modules, { recursive: true, force: true }));
  for (const arch of ['x64', 'arm64']) {
    for (const [name, file] of [[`sharp-darwin-${arch}`, 'sharp.node'], [`sharp-libvips-darwin-${arch}`, 'libvips.dylib']]) {
      const lib = join(modules, '@img', name, 'lib');
      await mkdir(lib, { recursive: true });
      await writeFile(join(lib, file), arch === 'x64' ? 'x86_64' : 'arm64');
    }
  }
  const inspect = async file => (await import('node:fs/promises')).readFile(file, 'utf8');
  await verifyNativeArchitecture({ modules, architecture: 'x64', inspect });
  await verifyNativeArchitecture({ modules, architecture: 'arm64', inspect });
  await writeFile(join(modules, '@img/sharp-darwin-arm64/lib/sharp.node'), 'x86_64');
  await assert.rejects(verifyNativeArchitecture({ modules, architecture: 'arm64', inspect }), /architecture/);
});
