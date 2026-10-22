import assert from 'node:assert/strict';
import test from 'node:test';
import { macosReleasePolicy, macosBuilderArgs, macosBuildEnvironment, assertMacosProof } from './macos-release-policy.mjs';

test('ad-hoc packaging requests both architectures without notarization and embeds manual update mode', () => {
  const args = macosBuilderArgs('adhoc', '/tmp/output');
  for (const value of ['--mac', '--arm64', '--x64', '--publish', 'never', '--config.mac.identity=-', '--config.mac.notarize=false', '--config.dmg.sign=false', '--config.extraMetadata.quoternMacosReleaseMode=adhoc']) assert(args.includes(value), value);
  assert.equal(macosReleasePolicy('adhoc').updatePolicy, 'manual');
  assert.equal(macosReleasePolicy('adhoc').notarized, false);
  assert.throws(() => macosReleasePolicy('auto'), /mode/i);
});

test('signed mode does not disable signed verification or inherit a manual marker', () => {
  const args = macosBuilderArgs('signed', '/tmp/output');
  assert(args.includes('--config.extraMetadata.quoternMacosReleaseMode=signed'));
  assert(!args.some(arg => arg.includes('notarize=false') || arg.includes('identity=-')));
  assert.equal(macosReleasePolicy('signed').notarized, true);
  assert.equal(macosReleasePolicy('signed').updatePolicy, 'automatic');
});

test('ad-hoc builder cannot import signing credentials or search the caller keychain', () => {
  const original = { CSC_LINK: 'private.p12', CSC_KEY_PASSWORD: 'secret', CSC_KEYCHAIN: '/old', CSC_NAME: 'Developer', APPLE_ID: 'dev', APPLE_APP_SPECIFIC_PASSWORD: 'secret', HTTPS_PROXY: 'http://proxy' };
  const env = macosBuildEnvironment(original, 'adhoc', '/tmp/empty.keychain-db');
  assert.equal(env.CSC_LINK, undefined);
  assert.equal(env.CSC_KEY_PASSWORD, undefined);
  assert.equal(env.CSC_NAME, undefined);
  assert.equal(env.APPLE_ID, undefined);
  assert.equal(env.CSC_KEYCHAIN, '/tmp/empty.keychain-db');
  assert.equal(env.HTTPS_PROXY, 'http://proxy');
  assert.equal(original.CSC_LINK, 'private.p12');
  assert.throws(() => macosBuildEnvironment(original, 'adhoc'), /keychain/i);
  assert.deepEqual(macosBuildEnvironment(original, 'signed'), original);
});

test('ad-hoc evidence cannot claim notarization or pass a signed assembly request', () => {
  const context = { mode: 'adhoc', version: '0.1.13', commit: 'a'.repeat(40) };
  const proof = { schemaVersion: 2, platform: 'darwin', passed: true, mode: 'adhoc', updatePolicy: 'manual', notarized: false, version: context.version, commit: context.commit, teamId: null,
    checks: ['codesign', 'adhoc-signature', 'architecture', 'version', 'update-policy', 'zip-extracted', 'dmg-mounted'] };
  assertMacosProof(proof, context);
  assert.throws(() => assertMacosProof({ ...proof, notarized: true }, context), /notar|policy/i);
  assert.throws(() => assertMacosProof(proof, { ...context, mode: 'signed' }), /mode|policy/i);
  assert.throws(() => assertMacosProof({ ...proof, checks: [...proof.checks, 'stapler'] }, context), /notar|checks/i);
  assert.throws(() => assertMacosProof({ ...proof, checks: [] }, context), /checks/i);
});
