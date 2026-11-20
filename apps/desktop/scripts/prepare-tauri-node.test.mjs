import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getNodeTarget, hostNodeTriple, prepareTauriNode } from './prepare-tauri-node.mjs';

const cases = [
  ['x86_64-pc-windows-msvc', 'win-x64/node.exe', 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5'],
  ['aarch64-pc-windows-msvc', 'win-arm64/node.exe', '8bea91dc437fe01e7d92ef0efc6c9eaf654369aaba9b2d3e9841552ea7b95a00'],
  ['x86_64-apple-darwin', 'node-v24.22.1-darwin-x64.tar.gz', 'd132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035'],
  ['aarch64-apple-darwin', 'node-v24.22.1-darwin-arm64.tar.gz', '89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7'],
  ['x86_64-unknown-linux-gnu', 'node-v24.22.1-linux-x64.tar.gz', 'eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c'],
  ['aarch64-unknown-linux-gnu', 'node-v24.22.1-linux-arm64.tar.gz', '33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3'],
];

test('maps each supported triple to the pinned official resource and hash', () => {
  for (const [triple, resource, sha256] of cases) {
    const target = getNodeTarget(triple);
    assert.equal(target.resource, resource);
    assert.equal(target.sha256, sha256);
    assert.equal(target.url, `https://nodejs.org/dist/v24.22.1/${resource}`);
  }
  assert.equal(hostNodeTriple('win32', 'x64'), 'x86_64-pc-windows-msvc');
  assert.equal(hostNodeTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(hostNodeTriple('linux', 'x64'), 'x86_64-unknown-linux-gnu');
});

test('rejects unsupported targets and hosts', async () => {
  assert.throws(() => getNodeTarget('x86_64-unknown-linux-musl'), /Unsupported Node target/);
  assert.throws(() => getNodeTarget('toString'), /Unsupported Node target/);
  assert.throws(() => hostNodeTriple('linux', 'ia32'), /Unsupported host/);
  await assert.rejects(prepareTauriNode('unknown'), /Unsupported Node target/);
});

test('a bad download does not replace an existing output', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-tauri-node-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'src-tauri', 'binaries');
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, 'quotern-node-x86_64-pc-windows-msvc.exe');
  await writeFile(output, 'existing binary');
  await assert.rejects(prepareTauriNode('x86_64-pc-windows-msvc', {
    root,
    execPath: path.join(root, 'missing-node.exe'),
    fetchImpl: async () => new Response('corrupt download'),
  }), /SHA256 mismatch/);
  assert.equal(await readFile(output, 'utf8'), 'existing binary');
});
