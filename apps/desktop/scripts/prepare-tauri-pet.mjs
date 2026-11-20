import { build } from 'esbuild';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareDshPet } from './prepare-dsh-pet.mjs';
import { petRuntimeFiles } from './tauri-pet-assets.mjs';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));


/** Stage only the browser runtime and the host files needed by the sidecar. */
export async function prepareTauriPet() {
  const source = path.join(desktopRoot, 'out/dsh-pet');
  const web = path.join(desktopRoot, 'out/tauri-pet-web');
  const sidecar = path.join(desktopRoot, 'out/sidecar/dsh-pet');
  await prepareDshPet();

  // Removing the two generated destinations prevents stale helper files from shipping.
  await rm(web, { recursive: true, force: true });
  await rm(sidecar, { recursive: true, force: true });
  await mkdir(web, { recursive: true });
  await mkdir(sidecar, { recursive: true });
  for (const name of petRuntimeFiles) {
    const input = path.join(source, 'runtime', name);
    const output = path.join(web, name);
    if (name === 'constants.js') {
      const constants = await readFile(input, 'utf8');
      const hook = 'function applyDeskGeometry(geo) {';
      if (constants.split(hook).length !== 2) throw Error('Unsupported fish display geometry hook');
      await writeFile(output, constants.replace(hook, hook + '\n  if (Number.isFinite(geo?.scale) && geo.scale > 0) CONFIG.scale = geo.scale;'));
      continue;
    }
    if (name !== 'index.html') {
      await copyFile(input, output);
      continue;
    }
    const html = await readFile(input, 'utf8');
    const marker = '<script src="./shared-core.js"></script>';
    if (html.split(marker).length !== 2) throw new Error('unsupported dsh-pet HTML script layout');
    await writeFile(output, html.replace(marker, '<script src="./native-bridge.js"></script>\n    ' + marker));
  }
  await build({
    entryPoints: [path.join(desktopRoot, 'src/renderer/dsh-native-bridge.ts')],
    outfile: path.join(web, 'native-bridge.js'),
    bundle: true, format: 'iife', platform: 'browser', target: 'safari16.4', logLevel: 'warning',
  });
  for (const name of ['host.cjs', 'LICENSE', 'MEDIA-LICENSE.md', 'PATCHES.md', 'UPSTREAM.json']) {
    await copyFile(path.join(source, name), path.join(sidecar, name));
  }
  await cp(path.join(source, 'assets'), path.join(sidecar, 'assets'), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepareTauriPet();
}
