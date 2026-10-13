const fs = require('node:fs/promises');
const { existsSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

/** Stage the pinned decoder's installed dependency closure, without workspace/UI dependencies. */
async function prepareNativeRuntime() {
  const app = path.resolve(__dirname, '..');
  const output = path.resolve(app, 'out/native-runtime');
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
      const installed = findPackage(dependency, root);
      if (installed) await stage(dependency, installed);
      else if (!Object.hasOwn(manifest.optionalDependencies ?? {}, dependency)) throw new Error(`Missing native runtime dependency: ${dependency}`);
    }
  }
  const sharp = findPackage('sharp', app);
  if (!sharp) throw new Error('Sharp is not installed; run pnpm install');
  await stage('sharp', sharp);
  console.log(`Prepared native decoder runtime (${staged.size} packages)`);
}
prepareNativeRuntime().catch((error) => { console.error(error); process.exitCode = 1; });
