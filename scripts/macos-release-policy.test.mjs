import assert from 'node:assert/strict';
import test from 'node:test';
import { macosReleasePolicy, macosTauriArgs, macosBuildEnvironment, assertMacosProof } from './macos-release-policy.mjs';

test('ad-hoc packaging requests both architectures without notarization and embeds manual update mode', () => {
  for (const [arch, target] of [['x64', 'x86_64-apple-darwin'], ['arm64', 'aarch64-apple-darwin']]) {
    const args = macosTauriArgs('adhoc', arch);
    assert.deepEqual(args.slice(0, 5), ['bundle', '--target', target, '--bundles', 'app,dmg']);
    assert.deepEqual(JSON.parse(args[6]), { bundle: { createUpdaterArtifacts: false, macOS: { signingIdentity: '-', entitlements: '../resources/entitlements.mac.plist' } } });
    assert(!args.includes('--publish'));
  }
  assert.equal(macosReleasePolicy('adhoc').updatePolicy, 'manual');
  assert.equal(macosReleasePolicy('adhoc').notarized, false);
  assert.throws(() => macosReleasePolicy('auto'), /mode/i);
});

test('signed mode does not disable signed verification or inherit a manual marker', () => {
  const args = macosTauriArgs('signed', 'arm64', 'Developer ID Application: Test (ABCDE12345)');
  assert.deepEqual(JSON.parse(args[6]), { bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: 'Developer ID Application: Test (ABCDE12345)', entitlements: '../resources/entitlements.mac.plist' } } });
  assert(!args.includes('--publish'));
  assert.throws(() => macosTauriArgs('signed', 'arm64', '-'), /identity/i);
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
  assert.equal(env.QUOTERN_MACOS_MODE, 'adhoc');
  assert.equal(original.CSC_LINK, 'private.p12');
  assert.throws(() => macosBuildEnvironment(original, 'adhoc'), /keychain/i);
  assert.throws(() => macosBuildEnvironment(original, 'signed'), /UPDATER_PUBLIC_KEY/);
  const signed = macosBuildEnvironment({ ...original, QUOTERN_UPDATER_PUBLIC_KEY: 'public', TAURI_SIGNING_PRIVATE_KEY: 'private' }, 'signed');
  assert.equal(signed.QUOTERN_MACOS_MODE, 'signed');
  assert.equal(signed.APPLE_PASSWORD, 'secret');
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
