import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const vendorRoot = new URL('../vendor/dsh-pet/', import.meta.url);

test('builds the full offline pet runtime without document previews or an unlicensed font', async () => {
  const { prepareDshPet } = await import('./prepare-dsh-pet.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-build-'));
  try {
    const outputRoot = path.join(root, 'output');
    await prepareDshPet({ vendorRoot, outputRoot });
    const animations = await readdir(path.join(outputRoot, 'assets/webm'));
    assert.equal(animations.length, 106);
    let bytes = 0;
    for (const name of animations) bytes += (await readFile(path.join(outputRoot, 'assets/webm', name))).byteLength;
    assert.equal(bytes, 54_351_332);
    await assert.rejects(readdir(path.join(outputRoot, 'assets/preview')), { code: 'ENOENT' });
    await assert.rejects(readdir(path.join(outputRoot, 'assets/fonts')), { code: 'ENOENT' });
    const context = vm.createContext({});
    vm.runInContext(await readFile(path.join(outputRoot, 'runtime/shared-core.js'), 'utf8'), context);
    assert.equal(typeof context.PetShared.flattenConfigPets, 'function');
    assert.equal(typeof context.PetShared.throwStep, 'function');
    const vendor = createRequire(import.meta.url)(path.join(outputRoot, 'host.cjs'));
    assert.equal(typeof vendor.readAllConfig, 'function');
    assert.equal(typeof vendor.PollStateStore, 'function');
    const config = vendor.readAllConfig({ defaultFile: path.join(outputRoot, 'assets/config.jsonc'), userFile: path.join(root, 'none'), petDir: path.join(root, 'pets') });
    assert.equal(config.main.font.family, 'system');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses missing or modified runtime assets instead of emitting a partial pet', async () => {
  const { prepareDshPet } = await import('./prepare-dsh-pet.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-corrupt-'));
  try {
    const copy = path.join(root, 'vendor');
    await cp(vendorRoot, copy, { recursive: true });
    const [name] = await readdir(path.join(copy, 'assets/webm'));
    await writeFile(path.join(copy, 'assets/webm', name), 'invalid');
    await assert.rejects(prepareDshPet({ vendorRoot: copy, outputRoot: path.join(root, 'output') }), /integrity|hash/i);
    await rm(path.join(copy, 'assets/webm', name));
    await assert.rejects(prepareDshPet({ vendorRoot: copy, outputRoot: path.join(root, 'output') }), /missing|ENOENT|integrity/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only packages manifest-owned files, ignoring extra local previews', async () => {
  const { prepareDshPet } = await import('./prepare-dsh-pet.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-extra-'));
  try {
    const copy = path.join(root, 'vendor');
    await cp(vendorRoot, copy, { recursive: true });
    await mkdir(path.join(copy, 'assets/preview'));
    await writeFile(path.join(copy, 'assets/preview/local.gif'), 'private local preview');
    const outputRoot = path.join(root, 'output');
    await prepareDshPet({ vendorRoot: copy, outputRoot });
    await assert.rejects(readFile(path.join(outputRoot, 'assets/preview/local.gif')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
