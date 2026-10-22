const { access, readFile, readdir, rm } = require('node:fs/promises');
const path = require('node:path');
const { sharpTargetPackages } = require('./prepare-native-runtime.cjs');

const MACOS_SIMPLIFIED_CHINESE_LOCALE = 'zh_CN.lproj';

/**
 * electron-builder 25 only removes locale files from Contents/Resources.
 * Chromium still ships macOS locale bundles under Electron Framework's
 * Resources, so strip unused languages here before the app is signed.
 */
module.exports = async function afterPack(context) {
  await verifySharpResources(context);
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appEntry = (await readdir(context.appOutDir, { withFileTypes: true })).find(
    (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
  );

  if (!appEntry) {
    throw new Error(`Unable to find packaged macOS app in ${context.appOutDir}`);
  }

  const localesDir = path.join(
    context.appOutDir,
    appEntry.name,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
  );
  const entries = await readdir(localesDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.endsWith('.lproj') &&
          entry.name !== MACOS_SIMPLIFIED_CHINESE_LOCALE,
      )
      .map((entry) => rm(path.join(localesDir, entry.name), { recursive: true, force: true })),
  );
};

async function verifySharpResources(context) {
  const platform = context.electronPlatformName;
  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : null;
  if (!arch) throw new Error(`Unsupported Sharp packaging architecture: ${context.arch}`);
  let resources = path.join(context.appOutDir, 'resources');
  if (platform === 'darwin') {
    const app = (await readdir(context.appOutDir)).find((name) => name.endsWith('.app'));
    if (!app) throw new Error('Packaged macOS application is missing');
    resources = path.join(context.appOutDir, app, 'Contents/Resources');
  }
  const modules = path.join(resources, 'app.asar.unpacked/node_modules');
  const nativePackages = sharpTargetPackages(platform, arch);
  const expected = new Set(nativePackages);
  for (const name of await readdir(path.join(modules, '@img'))) {
    if (name.startsWith('sharp-') && !expected.has(`@img/${name}`)) {
      throw new Error(`Unexpected Sharp native package for ${platform}-${arch}: @img/${name}`);
    }
  }
  const sharpDirectory = path.join(modules, 'sharp');
  const manifest = JSON.parse(await readFile(path.join(sharpDirectory, 'package.json'), 'utf8'));
  await access(path.join(sharpDirectory, manifest.main));
  const binary = path.join(modules, nativePackages[0], 'lib');
  const entries = await readdir(binary);
  if (!entries.some((name) => name.endsWith('.node'))) throw new Error(`Packaged Sharp native module is missing: ${binary}`);
  if (platform === 'win32') {
    if (!entries.some((name) => name.endsWith('.dll'))) throw new Error(`Packaged Sharp DLLs are missing: ${binary}`);
  } else {
    const vips = path.join(modules, nativePackages[1], 'lib');
    if (!(await readdir(vips)).some((name) => /\.(dylib|so(?:\..*)?)$/.test(name))) throw new Error(`Packaged libvips is missing: ${vips}`);
  }
}
