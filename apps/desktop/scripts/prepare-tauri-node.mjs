import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const version = '24.22.1';
const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const targets = {
  'x86_64-pc-windows-msvc': ['win', 'x64', 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5'],
  'aarch64-pc-windows-msvc': ['win', 'arm64', '8bea91dc437fe01e7d92ef0efc6c9eaf654369aaba9b2d3e9841552ea7b95a00'],
  'x86_64-apple-darwin': ['darwin', 'x64', 'd132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035'],
  'aarch64-apple-darwin': ['darwin', 'arm64', '89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7'],
  'x86_64-unknown-linux-gnu': ['linux', 'x64', 'eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c'],
  'aarch64-unknown-linux-gnu': ['linux', 'arm64', '33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3'],
};

export function getNodeTarget(triple) {
  if (!Object.hasOwn(targets, triple)) throw new Error(`Unsupported Node target: ${triple}`);
  const [os, arch, sha256] = targets[triple];
  const archiveRoot = `node-v${version}-${os}-${arch}`;
  const resource = os === 'win' ? `win-${arch}/node.exe` : `${archiveRoot}.tar.gz`;
  return { triple, os, arch, sha256, archiveRoot, resource, url: `https://nodejs.org/dist/v${version}/${resource}` };
}

export function hostNodeTriple(platform = process.platform, arch = process.arch) {
  const cpu = { x64: 'x86_64', arm64: 'aarch64' }[arch];
  const system = { win32: 'pc-windows-msvc', darwin: 'apple-darwin', linux: 'unknown-linux-gnu' }[platform];
  if (!cpu || !system) throw new Error(`Unsupported host: ${platform}-${arch}`);
  return `${cpu}-${system}`;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function matchesHash(file, expected) {
  try { return await hashFile(file) === expected; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function prepareTauriNode(triple = hostNodeTriple(), { root = desktopRoot, fetchImpl = fetch, execPath = process.execPath } = {}) {
  const target = getNodeTarget(triple);
  const cacheDir = path.join(root, 'out', 'tauri-node-cache');
  const outputDir = path.join(root, 'src-tauri', 'binaries');
  const output = path.join(outputDir, `quotern-node-${triple}${target.os === 'win' ? '.exe' : ''}`);
  await mkdir(cacheDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const temp = await mkdtemp(path.join(cacheDir, 'prepare-'));
  const outputTemp = await mkdtemp(path.join(outputDir, '.node-'));
  try {
    let source;
    if (target.os === 'win' && process.platform === 'win32' && process.arch === target.arch && await matchesHash(execPath, target.sha256)) {
      source = execPath;
    } else {
      const cache = path.join(cacheDir, target.resource.replaceAll('/', '-'));
      if (!await matchesHash(cache, target.sha256)) {
        const downloaded = path.join(temp, 'download');
        const response = await fetchImpl(target.url);
        if (!response.ok || !response.body) throw new Error(`Node download failed: ${response.status} ${target.url}`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(downloaded, { flags: 'wx' }));
        if (!await matchesHash(downloaded, target.sha256)) throw new Error(`Node SHA256 mismatch: ${target.resource}`);
        await rename(downloaded, cache);
      }
      if (target.os === 'win') source = cache;
      else {
        const member = `${target.archiveRoot}/bin/node`;
        await run('tar', ['-xzf', cache, '-C', temp, member]);
        source = path.join(temp, ...member.split('/'));
      }
    }
    const staged = path.join(outputTemp, 'node');
    await copyFile(source, staged);
    if (target.os === 'win' && !await matchesHash(staged, target.sha256)) throw new Error(`Node SHA256 mismatch: ${target.resource}`);
    await chmod(staged, 0o755);
    await rename(staged, output);
    return output;
  } finally {
    await rm(temp, { recursive: true, force: true });
    await rm(outputTemp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareTauriNode(process.argv[2]).then(output => console.log(output)).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
