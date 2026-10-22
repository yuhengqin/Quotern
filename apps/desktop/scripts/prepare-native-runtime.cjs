const fs = require('node:fs/promises');
const { existsSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { parseArgs } = require('node:util');

function sharpTargetPackages(platform, arch) {
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error(`Unsupported Sharp target platform: ${platform}`);
  const musl = platform === 'linux' && process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime;
  const runtime = `${platform}${musl ? 'musl' : ''}-${arch}`;
  return [`@img/sharp-${runtime}`, ...(platform === 'win32' ? [] : [`@img/sharp-libvips-${runtime}`])];
}

/** Keep ordinary dependencies and only this target's complete native packages. */
async function prepareNativeRuntime({ appDirectory = path.resolve(__dirname, '..'), platform = process.platform, arch = process.arch, outputDirectory } = {}) {
  const app = path.resolve(appDirectory);
  const output = path.resolve(outputDirectory ?? path.join(app, 'out/native-runtime'));
  const required = new Set(sharpTargetPackages(platform, arch));
  if (!output.startsWith(path.resolve(app, 'out') + path.sep)) throw new Error('Invalid native runtime output');
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  const staged = new Map();
  function findPackage(name, parent) {
    const require = createRequire(path.join(parent, 'package.json'));
    for (const root of require.resolve.paths(name) ?? []) {
      const candidate = path.join(root, name, 'package.json');
      if (existsSync(candidate)) return realpathSync(path.dirname(candidate));
    }
    return null;
  }
  async function stage(name, root) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (staged.has(name)) {
      if (staged.get(name) !== manifest.version) throw new Error(`Conflicting native runtime versions: ${name}`);
      return;
    }
    staged.set(name, manifest.version);
    await fs.cp(root, path.join(output, name), { recursive: true, dereference: true });
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      // Sharp declares binaries for every platform as optional. They are not all runtime dependencies.
      if (dependency.startsWith('@img/sharp-') && !required.has(dependency)) continue;
      const installed = findPackage(dependency, root);
      if (installed) await stage(dependency, installed);
      else if (required.has(dependency) || !Object.hasOwn(manifest.optionalDependencies ?? {}, dependency)) {
        throw new Error(`Missing native runtime dependency for ${platform}-${arch}: ${dependency}`);
      }
    }
  }
  const sharp = findPackage('sharp', app);
  if (!sharp) throw new Error('Sharp is not installed; run pnpm install');
  await stage('sharp', sharp);
  for (const dependency of required) {
    if (!staged.has(dependency)) throw new Error(`Missing native runtime dependency for ${platform}-${arch}: ${dependency}`);
  }
  console.log(`Prepared native decoder runtime for ${platform}-${arch} (${staged.size} packages)`);
}

/** Each target owns its staging directory, including when builder packs architectures concurrently. */
async function beforePack(context) {
  const platform = context.electronPlatformName;
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (!arch) throw new Error(`Unsupported Sharp packaging architecture: ${context.arch}`);
  const os = { win32: 'win', darwin: 'mac', linux: 'linux' }[platform];
  const appDirectory = context.packager.info.appDir;
  await prepareNativeRuntime({ appDirectory, platform, arch, outputDirectory: path.join(appDirectory, 'out/native-runtime', `${os}-${arch}`) });
}

module.exports = beforePack;
module.exports.sharpTargetPackages = sharpTargetPackages;

if (require.main === module) {
  const { values } = parseArgs({ options: { platform: { type: 'string' }, arch: { type: 'string' } } });
  prepareNativeRuntime({ platform: values.platform, arch: values.arch }).catch((error) => { console.error(error); process.exitCode = 1; });
}
