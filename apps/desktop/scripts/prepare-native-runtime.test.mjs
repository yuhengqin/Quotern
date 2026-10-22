import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
  await cp(new URL('./after-pack.cjs', import.meta.url), path.join(app, 'scripts/after-pack.cjs'));
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

test('beforePack stages x64 and arm64 independently without deleting the other target', async t => {
  const app = await fixture(t);
  const beforePack = require(path.join(app, 'scripts/prepare-native-runtime.cjs'));
  await Promise.all([1, 3].map(arch => beforePack({ packager: { info: { appDir: app } }, electronPlatformName: 'win32', arch })));
  assert.deepEqual(await packagesAt(path.join(app, 'out/native-runtime/win-x64')), [...common, '@img/sharp-win32-x64'].sort());
  assert.deepEqual(await packagesAt(path.join(app, 'out/native-runtime/win-arm64')), [...common, '@img/sharp-win32-arm64'].sort());
  await beforePack({ packager: { info: { appDir: app } }, electronPlatformName: 'win32', arch: 1 });
  assert.deepEqual(await packagesAt(path.join(app, 'out/native-runtime/win-arm64')), [...common, '@img/sharp-win32-arm64'].sort());
});

test('afterPack rejects a foreign architecture even when the correct native binding is present', async t => {
  const app = await fixture(t);
  const output = path.join(app, 'packaged/resources/app.asar.unpacked/node_modules');
  await mkdir(output, { recursive: true });
  for (const name of [...common, '@img/sharp-win32-x64', '@img/sharp-win32-arm64']) {
    await cp(path.join(app, 'node_modules', name), path.join(output, name), { recursive: true });
  }
  const afterPack = require(path.join(app, 'scripts/after-pack.cjs'));
  await assert.rejects(afterPack({ appOutDir: path.join(app, 'packaged'), electronPlatformName: 'win32', arch: 1 }), /sharp-win32-arm64/);
});

test('the builder unpack filter matches staged source files before their node_modules mapping', async t => {
  const app = await fixture(t);
  const beforePack = require(path.join(app, 'scripts/prepare-native-runtime.cjs'));
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const { getFileMatchers } = libraryRequire('./fileMatcher');
  const { load } = createRequire(new URL('../../../package.json', import.meta.url))('js-yaml');
  const config = load(await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'));
  for (const [platform, arch, os, selected] of targets.filter(([platform]) => platform !== 'linux')) {
    await beforePack({ packager: { info: { appDir: app } }, electronPlatformName: platform, arch: arch === 'x64' ? 1 : 3 });
    const [matcher] = getFileMatchers(config, 'asarUnpack', path.join(app, 'resources/app'), {
      defaultSrc: app, globalOutDir: path.join(app, 'release'), customBuildOptions: {},
      macroExpander: value => value.replaceAll('${os}', os).replaceAll('${arch}', arch),
    });
    const unpack = matcher.createFilter();
    for (const relative of ['sharp/package.json', `${selected[0]}/lib/sharp.node`]) {
      const source = path.join(app, `out/native-runtime/${os}-${arch}`, relative);
      assert.equal(unpack(source, await stat(source)), true, `builder must unpack the original staged source: ${relative}`);
    }
  }
});
