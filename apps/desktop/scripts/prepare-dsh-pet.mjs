import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const hostModules = ['config', 'state', 'work-status', 'notify-events', 'memes', 'anim', 'broadcast', 'time-context', 'model-selection'];

/** Build only the checked-in snapshot. No reference checkout, network or user data. */
export async function prepareDshPet({ vendorRoot = path.join(desktopRoot, 'vendor/dsh-pet'), outputRoot = path.join(desktopRoot, 'out/dsh-pet') } = {}) {
  const vendor = vendorRoot instanceof URL ? fileURLToPath(vendorRoot) : path.resolve(vendorRoot);
  const output = path.resolve(outputRoot);
  if (output === vendor || output.startsWith(`${vendor}${path.sep}`)) throw new Error('output must be outside vendor snapshot');
  const manifest = JSON.parse(await readFile(path.join(vendor, 'UPSTREAM.json'), 'utf8'));
  if (manifest.commit !== '6c5f04321be050525b5cbb7bb8ee5f53e89deb6f') throw new Error('unsupported upstream snapshot');
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('..') || path.isAbsolute(entry.path)) throw new Error('invalid integrity path');
    const data = await readFile(path.join(vendor, entry.path));
    if (data.byteLength !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) {
      throw new Error(`dsh-pet integrity hash mismatch: ${entry.path}`);
    }
  }
  await mkdir(path.join(output, 'runtime'), { recursive: true });
  for (const entry of manifest.files) {
    const relative = entry.path.startsWith('runtime/electron-helper/')
      ? entry.path.replace('runtime/electron-helper/', 'runtime/')
      : entry.path.startsWith('assets/') ? entry.path : null;
    if (!relative) continue;
    await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await cp(path.join(vendor, entry.path), path.join(output, relative));
  }
  await cp(path.join(vendor, 'LICENSE'), path.join(output, 'LICENSE'));
  await cp(path.join(vendor, 'UPSTREAM.json'), path.join(output, 'UPSTREAM.json'));
  const config = (await readFile(path.join(vendor, 'assets/config.jsonc'), 'utf8'))
    .replace(/("family"\s*:\s*)"candy"/, '$1"system"')
    .replace(/("display"\s*:\s*)"both"/g, '$1"desktop"');
  await writeFile(path.join(output, 'assets/config.jsonc'), config);
  await build({ entryPoints: [path.join(vendor, 'src/shared/index.ts')], outfile: path.join(output, 'runtime/shared-core.js'), bundle: true, format: 'iife', globalName: 'PetShared', platform: 'browser', target: 'chrome134', logLevel: 'warning',
    plugins: [{ name: 'quotern-window-label', setup(bundle) {
      bundle.onLoad({ filter: /[/\\]src[/\\]shared[/\\]balance\.ts$/ }, async args => {
        let contents = await readFile(args.path, 'utf8');
        for (const [from, to] of [
          ['monthly?: unknown;', 'monthly?: unknown; monthlyLabel?: unknown;'],
          ['monthly?: number;', 'monthly?: number; monthlyLabel?: string;'],
          ['      monthly,', '      monthly,\n      monthlyLabel: typeof d.monthlyLabel === "string" ? d.monthlyLabel : undefined,'],
          ['  return WINDOW_LABELS[w];', '  if (w === "monthly" && v.monthlyLabel) return v.monthlyLabel;\n  return WINDOW_LABELS[w];'],
        ]) { if (!contents.includes(from)) throw new Error('unsupported upstream balance renderer'); contents = contents.replace(from, to); }
        return { loader: 'ts', contents };
      });
    } }],
  });
  await build({
    stdin: { contents: hostModules.map(name => `export * from './${name}.ts';`).join('\n'), resolveDir: path.join(vendor, 'src/host'), loader: 'ts' },
    outfile: path.join(output, 'host.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'warning',
    plugins: [{ name: 'quotern-jsonc', setup(bundle) {
      bundle.onLoad({ filter: /[/\\]src[/\\]host[/\\]config\.ts$/ }, async args => {
        const original = await readFile(args.path, 'utf8');
        const patched = original.replace(/function stripJsonc\(src: string\): string \{[\s\S]*?\n\}/, 'function stripJsonc(src: string): string { return quoternStripJsonComments(src).trim(); }');
        if (original === patched) throw new Error('unsupported upstream JSONC parser');
        return { loader: 'ts', contents: `import { stripJsonComments as quoternStripJsonComments } from ${JSON.stringify(path.join(desktopRoot, 'src/main/dsh-pet/jsonc.ts'))};\n${patched}` };
      });
    } }],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepareDshPet();
}
