export function macosReleasePolicy(mode) {
  if (!['adhoc', 'signed'].includes(mode)) throw new Error(`Invalid macOS release mode: ${mode}`);
  const signed = mode === 'signed';
  return { mode, updatePolicy: signed ? 'automatic' : 'manual', notarized: signed,
    checks: ['codesign', 'architecture', 'version', 'update-policy', 'zip-extracted', 'dmg-mounted', ...(signed ? ['spctl', 'stapler'] : ['adhoc-signature'])] };
}

export function macosTauriArgs(mode, architecture, identity) {
  macosReleasePolicy(mode);
  const target = { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' }[architecture];
  if (!target) throw new Error(`Invalid macOS architecture: ${architecture}`);
  if (mode === 'signed' && (!identity || identity === '-')) throw new Error('Signed builds require a verified Developer ID identity');
  const config = { bundle: { createUpdaterArtifacts: mode === 'signed', macOS: {
    signingIdentity: mode === 'adhoc' ? '-' : identity, entitlements: '../resources/entitlements.mac.plist',
  } } };
  return ['bundle', '--target', target, '--bundles', 'app,dmg', '--config', JSON.stringify(config)];
}

export function macosBuildEnvironment(original, mode, keychain) {
  macosReleasePolicy(mode);
  const env = { ...original };
  env.QUOTERN_MACOS_MODE = mode;
  if (mode === 'signed') {
    if (!env.QUOTERN_UPDATER_PUBLIC_KEY || !env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Signed builds require QUOTERN_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY');
    if (env.APPLE_APP_SPECIFIC_PASSWORD) env.APPLE_PASSWORD = env.APPLE_APP_SPECIFIC_PASSWORD;
    return env;
  }
  if (!keychain) throw new Error('Ad-hoc builds require an empty signing keychain');
  for (const key of Object.keys(env)) if (/^(CSC_|WIN_CSC_|APPLE_|TAURI_SIGNING_)/i.test(key)) delete env[key];
  return { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_KEYCHAIN: keychain };
}

export function assertMacosProof(proof, { mode, version, commit }) {
  const policy = macosReleasePolicy(mode);
  if (proof.schemaVersion !== 2 || proof.platform !== 'darwin' || proof.passed !== true || proof.mode !== mode || proof.version !== version || proof.commit !== commit) throw new Error('Invalid macOS verification evidence or mismatched mode/version/commit');
  if (proof.updatePolicy !== policy.updatePolicy || proof.notarized !== policy.notarized) throw new Error('macOS verification policy/notarization mismatch');
  if (mode === 'signed' ? !/^[A-Z0-9]{10}$/.test(proof.teamId ?? '') : proof.teamId !== null) throw new Error('Unexpected macOS signing team');
  if (!Array.isArray(proof.checks) || !policy.checks.every(check => proof.checks.includes(check))
    || (mode === 'adhoc' && proof.checks.some(check => ['spctl', 'stapler', 'notarization'].includes(check)))) throw new Error('Invalid or incomplete macOS verification checks');
}
