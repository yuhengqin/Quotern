import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const script = new URL('./prepare-native-runtime.cjs', import.meta.url);
const require = createRequire(import.meta.url);
const targets = [
  ['win32', 'x64', 'win', ['@img/sharp-win32-x64']],
  ['win32', 'arm64', 'win', ['@img/sharp-win32-arm64']],
  ['darwin', 'x64', 'mac', ['@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64']],
  ['darwin', 'arm64', 'mac', ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64']],
  ['linux', 'x64', 'linux', ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']],
];
const common = ['@img/colour', 'detect-libc', 'semver', 'sharp'];

async function fixture(t) {
  const app = await mkdtemp(path.join(tmpdir(), 'quotern-native-runtime-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  await mkdir(path.join(app, 'scripts'));
  await cp(script, path.join(app, 'scripts/prepare-native-runtime.cjs'));
  await cp(new URL('./build-sidecar.mjs', import.meta.url), path.join(app, 'scripts/build-sidecar.mjs'));
  await writeFile(path.join(app, 'package.json'), '{}');
  async function pkg(name, manifest = {}, files = {}) {
    const root = path.join(app, 'node_modules', name);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.cjs', ...manifest }));
    await writeFile(path.join(root, 'index.cjs'), 'module.exports = {};');
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), contents);
    }
  }
  for (const name of common.slice(0, -1)) await pkg(name);
  const optionalDependencies = { '@img/sharp-freebsd-wasm32': '1.0.0' };
  await pkg('@img/sharp-freebsd-wasm32', { os: ['freebsd'] });
  for (const [platform, arch, , packages] of targets) {
    for (const name of packages) optionalDependencies[name] = '1.0.0';
    const native = packages[0];
    await pkg(native, {
      os: [platform], cpu: [arch],
      ...(packages[1] ? { optionalDependencies: { [packages[1]]: '1.0.0' } } : {}),
    }, { 'lib/sharp.node': 'native binding', ...(platform === 'win32' ? { 'lib/libvips.dll': 'vips DLL' } : {}) });
    if (packages[1]) await pkg(packages[1], { os: [platform], cpu: [arch] }, {
      [`lib/libvips.${platform === 'darwin' ? 'dylib' : 'so'}`]: 'vips shared library',
    });
  }
  await pkg('sharp', { dependencies: { '@img/colour': '1.0.0', 'detect-libc': '1.0.0', semver: '1.0.0' }, optionalDependencies });
  return app;
}

async function packagesAt(directory) {
  const packages = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('@')) {
      for (const name of await readdir(path.join(directory, entry.name))) packages.push(`${entry.name}/${name}`);
    } else packages.push(entry.name);
  }
  return packages.sort();
}

for (const [platform, arch, , selected] of targets) {
  test(`stages only the ${platform}-${arch} Sharp closure and preserves colour and native libraries`, async t => {
    const app = await fixture(t);
    await run(process.execPath, [path.join(app, 'scripts/prepare-native-runtime.cjs'), '--platform', platform, '--arch', arch]);
    const output = path.join(app, 'out/native-runtime');
    assert.deepEqual(await packagesAt(output), [...common, ...selected].sort());
    assert.equal(await readFile(path.join(output, selected[0], 'lib/sharp.node'), 'utf8'), 'native binding');
    if (platform === 'win32') assert.equal(await readFile(path.join(output, selected[0], 'lib/libvips.dll'), 'utf8'), 'vips DLL');
  });
}

for (const missing of ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64', '@img/colour']) {
  test(`fails instead of packaging an unusable runtime when ${missing} is missing`, async t => {
    const app = await fixture(t);
    await rm(path.join(app, 'node_modules', missing), { recursive: true });
    await assert.rejects(
      run(process.execPath, [path.join(app, 'scripts/prepare-native-runtime.cjs'), '--platform', 'darwin', '--arch', 'arm64']),
      error => error.code !== 0 && error.stderr.includes(missing),
    );
  });
}

test('prepareNativeRuntime stages x64 and arm64 independently without deleting the other target', async t => {
  const app = await fixture(t);
  const { prepareNativeRuntime } = require(path.join(app, 'scripts/prepare-native-runtime.cjs'));
  const prepare = arch => prepareNativeRuntime({ appDirectory: app, platform: 'win32', arch, outputDirectory: path.join(app, `out/native-runtime/win-${arch}`) });
  await Promise.all(['x64', 'arm64'].map(prepare));
  assert.deepEqual(await packagesAt(path.join(app, 'out/native-runtime/win-x64')), [...common, '@img/sharp-win32-x64'].sort());
  assert.deepEqual(await packagesAt(path.join(app, 'out/native-runtime/win-arm64')), [...common, '@img/sharp-win32-arm64'].sort());
  await prepare('x64');
  assert.deepEqual(await packagesAt(path.join(app, 'out/native-runtime/win-arm64')), [...common, '@img/sharp-win32-arm64'].sort());
});

for (const [platform, arch, , selected] of targets.filter(([platform]) => platform !== 'linux')) {
  test(`build-sidecar stages ${platform}-${arch} for Node without an ABI rebuild`, async t => {
    const app = await fixture(t);
    const esbuild = path.join(app, 'node_modules/esbuild');
    await mkdir(path.join(app, 'resources'), { recursive: true });
    await writeFile(path.join(app, 'resources/icon.png'), 'fixture notification icon');
    await writeFile(path.join(app, 'resources/node-LICENSE.txt'), 'fixture Node license');
    await writeFile(path.join(app, 'THIRD_PARTY_NOTICES.md'), 'fixture notices');
    await mkdir(esbuild, { recursive: true });
    await writeFile(path.join(esbuild, 'package.json'), '{"name":"esbuild","type":"module","exports":"./index.mjs"}');
    await writeFile(path.join(esbuild, 'index.mjs'), `import { writeFile } from 'node:fs/promises';
      export async function build(options) { await writeFile(process.env.FIXTURE_BUILD_OPTIONS, JSON.stringify(options)); }`);
    const preload = path.join(app, 'reject-child-process.cjs');
    await writeFile(preload, `const child = require('node:child_process');
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
        child[name] = () => { throw new Error('Unexpected ABI rebuild or child process'); };
      require('node:module').syncBuiltinESMExports();`);
    const optionsFile = path.join(app, 'build-options.json');
    await run(process.execPath, ['--require', preload, path.join(app, 'scripts/build-sidecar.mjs')], {
      env: { ...process.env, TAURI_ENV_PLATFORM: platform === 'win32' ? 'windows' : 'macos', QUOTERN_TARGET_ARCH: arch, FIXTURE_BUILD_OPTIONS: optionsFile },
    });
    const output = path.join(app, 'out/sidecar/node_modules');
    assert.deepEqual(await packagesAt(output), [...common, ...selected].sort());
    assert.equal(await readFile(path.join(output, selected[0], 'lib/sharp.node'), 'utf8'), 'native binding');
    const options = JSON.parse(await readFile(optionsFile, 'utf8'));
    assert.equal(options.platform, 'node');
    assert.equal(options.target, 'node24');
    assert.deepEqual(options.external, ['sharp']);
    assert.equal(options.outdir, path.join(app, 'out/sidecar'));
  });
}
