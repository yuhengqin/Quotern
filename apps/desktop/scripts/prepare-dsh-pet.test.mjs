import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const vendorRoot = new URL('../vendor/dsh-pet/', import.meta.url);

test('generated desktop wandering respects the current screen and the facing after a turn', async () => {
  const { prepareDshPet } = await import('./prepare-dsh-pet.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-wandering-'));
  try {
    await prepareDshPet({ vendorRoot, outputRoot: root });
    const context = vm.createContext({
      VIEW: { w: 2000, h: 800 },
      AREAS: [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 1000, y: 0, width: 1000, height: 800 }],
    });
    vm.runInContext(await readFile(path.join(root, 'runtime/shared-core.js'), 'utf8'), context);
    vm.runInContext(`const S = PetShared;\n${await readFile(path.join(root, 'runtime/sprite.js'), 'utf8')}
      function wander({ x = 500, facing = 'right', locked = false, anim = 'turn' } = {}) {
        const pet = Object.assign(Object.create(PetSprite.prototype), {
          moveRef: null, pendingMove: null, throwRef: null,
          size: S.PET_REF_WIDTH, halfW: 40, sideAllow: 0,
          facing, confineToScreen: locked, anim,
          animations: { turn: ['turn'], moves: {
            actions: [{ name: 'walk' }],
            default: { minDist: 100, maxDist: 100, margin: 0, leadSec: 0, tailSec: 0 },
          } },
          currentCenterX: () => x, currentCenterY: () => 400,
          switchTo: () => {},
        });
        return { result: pet.tryMove('walk'), plan: pet.pendingMove };
      }
    `, context);
    assert.equal(vm.runInContext("wander({ facing: 'right' }).plan.dir", context), 1, 'a completed turn must not invert rightward walking');
    assert.equal(vm.runInContext("wander({ facing: 'left' }).plan.dir", context), -1, 'a completed turn must not invert leftward walking');
    assert.equal(vm.runInContext("wander({ x: 950, locked: true, anim: 'idle' }).result", context), false, 'locked wandering must stop at an adjacent screen');
    assert.equal(vm.runInContext("wander({ x: 950, anim: 'idle' }).result", context), 'walk', 'unlocked wandering still crosses adjacent screens');
    assert.equal(vm.runInContext("wander({ x: 1200, locked: true }).plan.dir", context), 1, 'the current screen can be a secondary screen');
    vm.runInContext('AREAS[1].x = 1200;', context);
    assert.equal(vm.runInContext("wander({ x: 1050, facing: 'left', locked: true, anim: 'idle' }).result", context), 'walk', 'a pet in a display gap uses its nearest screen');
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
    assert.equal(context.PetShared.mountChatDialog, undefined);
    const sprite = await readFile(path.join(outputRoot, 'runtime/sprite.js'), 'utf8');
    assert.doesNotMatch(sprite, /showChatFromMenu|showWhisperFromMenu|mountChatDialog|action: 'chat'|action: 'whisper'/);
    const balance = context.PetShared.toBalanceState({ ok: true, provider: 'Codex', shape: 'windows', data: { monthly: 95, monthlyLabel: '每日请求', monthlyResetsAt: '2030-01-01T00:00:00Z' } });
    assert.ok(context.PetShared.balanceBubbleView(balance).some(row => row.text.includes('每日请求')));
    const vendor = createRequire(import.meta.url)(path.join(outputRoot, 'host.cjs'));
    assert.equal(typeof vendor.readAllConfig, 'function');
    assert.equal(typeof vendor.PollStateStore, 'function');
    const config = vendor.readAllConfig({ defaultFile: path.join(outputRoot, 'assets/config.jsonc'), userFile: path.join(root, 'none'), petDir: path.join(root, 'pets') });
    assert.equal(config.main.font.family, 'system');
    const helper = await readFile(path.join(outputRoot, 'runtime/main.js'), 'utf8');
    const ignoreFunction = helper.match(/function setWindowIgnore\(win, ignore\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(ignoreFunction, 'native mouse policy remains testable in the generated helper');
    for (const platform of ['win32', 'darwin', 'linux']) {
      const calls = [], inputContext = vm.createContext({ process: { platform }, windowIgnore: new Map(), win: { id: 1, setIgnoreMouseEvents: (...args) => calls.push(args) } });
      vm.runInContext(ignoreFunction + '\nsetWindowIgnore(win, true);', inputContext);
      assert.equal(calls[0][0], true);
      assert.equal(calls[0][1].forward, platform !== 'win32', 'Windows must not register Electron\'s global mouse hook');
    }
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
