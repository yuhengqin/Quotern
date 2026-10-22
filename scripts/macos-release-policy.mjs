export function macosReleasePolicy(mode) {
  if (!['adhoc', 'signed'].includes(mode)) throw new Error(`Invalid macOS release mode: ${mode}`);
  const signed = mode === 'signed';
  return { mode, updatePolicy: signed ? 'automatic' : 'manual', notarized: signed,
    checks: ['codesign', 'architecture', 'version', 'update-policy', 'zip-extracted', 'dmg-mounted', ...(signed ? ['spctl', 'stapler'] : ['adhoc-signature'])] };
}

export function macosBuilderArgs(mode, dir) {
  macosReleasePolicy(mode);
  return ['--mac', '--arm64', '--x64', '--publish', 'never', `--config.directories.output=${dir}`,
    '--config.mac.type=distribution', `--config.extraMetadata.quoternMacosReleaseMode=${mode}`,
    ...(mode === 'adhoc' ? ['--config.mac.identity=-', '--config.mac.forceCodeSigning=false', '--config.mac.hardenedRuntime=false', '--config.mac.notarize=false', '--config.dmg.sign=false'] : [])];
}

export function macosBuildEnvironment(original, mode, keychain) {
  macosReleasePolicy(mode);
  const env = { ...original };
  if (mode === 'signed') return env;
  if (!keychain) throw new Error('Ad-hoc builds require an empty signing keychain');
  for (const key of Object.keys(env)) if (/^(CSC_|WIN_CSC_|APPLE_)/i.test(key)) delete env[key];
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
