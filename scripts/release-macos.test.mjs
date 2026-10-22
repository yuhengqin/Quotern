import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appleCredentials, assertAppIdentity, assertArchitecture, notarizeDmg, verifyNativeArchitecture } from './release-macos.mjs';

const team = 'ABCDE12345';
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
