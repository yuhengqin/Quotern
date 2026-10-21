import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { prepareDshPet } from './prepare-dsh-pet.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-controls-'));
  const reports = [];
  class Video extends EventTarget {
    style = {}; classList = { add() {}, remove() {} }; readyState = 0;
    play() { return this.rejectPlay ? Promise.reject(new Error('decode')) : Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
  }
  try {
    await prepareDshPet({ outputRoot: root });
    const context = vm.createContext({ console, Event, setTimeout, clearTimeout, Date, URLSearchParams,
      window: { setTimeout, clearTimeout, __dshPetDebug: {}, addEventListener() {} },
      fetch: async (url, options) => { reports.push({ url, body: JSON.parse(options?.body ?? '{}') }); const snapshot = context.snapshot; if (String(url).endsWith('/state') && context.blockState) await context.blockState; return { ok: true, json: async () => String(url).endsWith('/state') ? snapshot : ({ ok: true }) }; },
      STATE_URL: 'http://pet/dsh-pet-7340/state', sprites: [],
      BASE: 'http://pet/dsh-pet-7340', VIEW: { w: 2000, h: 800 }, AREAS: [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 1200, y: 0, width: 800, height: 800 }],
      Video, performance, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    });
    vm.runInContext(await readFile(path.join(root, 'runtime/shared-core.js'), 'utf8'), context);
    vm.runInContext(`const S = PetShared;\n${await readFile(path.join(root, 'runtime/sprite.js'), 'utf8')}`, context);
    vm.runInContext(await readFile(path.join(root, 'runtime/events.js'), 'utf8'), context);
    vm.runInContext(await readFile(path.join(root, 'runtime/controls.js'), 'utf8'), context);
    vm.runInContext(`const pet = Object.assign(Object.create(PetSprite.prototype), {
      pet: { id: 'main' }, pos: {x:100,y:100}, size: 100, halfW: 50, halfH: 28.125,
      assetBase: '/assets/', gen: 0, front: 0, pending: null, facing:'left',
      dragState: {active:false}, videoA: new Video(), videoB: new Video(),
      animations: { idle:['idle'], turn:[], clicks:[], drag:[], moves:{actions:[]} },
      stopMove() {}, stopThrow() {}, stopDragFollow() {}, renderBubble() {}, playIdle() {},
      syncInputBusy() {}, sendBounds(x,y) { this.pos={x,y}; },
    }); sprites.push(pet);`, context);
    await run(context, reports);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('generated controls report actual media success, failure, replacement and end', async () => fixture(async (context, reports) => {
  vm.runInContext("pet.switchTo('idle', true, 'first'); pet.videoB.dispatchEvent(new Event('loadeddata'));", context);
  await settle();
  assert.equal(reports.at(-1).body.status, 'playing');
  vm.runInContext('pet.videoB.onended();', context);
  assert.equal(reports.at(-1).body.status, 'ended');
  vm.runInContext("pet.switchTo('idle', true, 'second'); pet.switchTo('idle', true, 'third');", context);
  assert.ok(reports.some(report => report.url.includes('second') && report.body.status === 'cancelled'));
  vm.runInContext("pet.videoA.rejectPlay=true; pet.videoA.dispatchEvent(new Event('loadeddata'));", context);
  await settle();
  assert.equal(reports.at(-1).body.status, 'failed');
}));

test('generated controls freeze animation, allow user takeover, and clamp center to real displays', async () => fixture(async (context, reports) => {
  vm.runInContext("pet.switchTo('idle', true, 'one'); pet.applyControlLock({locked:true,expiresAt:Date.now()+10000});", context);
  assert.equal(vm.runInContext('pet.frozen', context), true);
  assert.equal(reports.at(-1).body.status, 'cancelled');
  vm.runInContext('pet.preemptControl();', context);
  await settle();
  assert.equal(vm.runInContext('pet.frozen', context), false);
  assert.ok(reports.some(report => report.url.includes('lock/release') && report.body.force === true));
  vm.runInContext("pet.moveToCenter(.55,.5,'instant');", context);
  const center = vm.runInContext('({x:pet.pos.x+pet.halfW,y:pet.pos.y+pet.halfH})', context);
  assert.ok(center.x <= 1000 || center.x >= 1200, 'a normalized target must never land in a display gap');
  vm.runInContext("pet.dragState.active=true; pet.moveToCenter(.9,.1,'instant');", context);
  assert.equal(vm.runInContext('pet.pos.x+pet.halfW', context), center.x, 'programmatic movement must yield to the held pointer');
}));

test('a position queued during startup is applied on the first renderer state read', async () => fixture(async context => {
  context.snapshot = { counter: 1, sections: {}, pets: { main: { position: { counter: 1, data: { x: .25, y: .5, mode: 'instant' } } } } };
  await vm.runInContext('pollStateOnce()', context);
  assert.equal(vm.runInContext('pet.pos.x+pet.halfW', context), 500);
}));

test('unlock resumes idle when the work state cleared while the pet was frozen', async () => fixture(async context => {
  vm.runInContext(`pet.idleStarts=0; pet.playIdle=()=>{pet.idleStarts++;};
    pet.applyControlLock({locked:true,expiresAt:Date.now()+10000});
    pet.onWorkTick({state:null,task:null}, 1);
    pet.applyControlLock({locked:false});`, context);
  assert.equal(vm.runInContext('pet.idleStarts', context), 1);
}));

test('user takeover releases an unobserved host lock and rejects an already in-flight old snapshot', async () => fixture(async (context, reports) => {
  let release;
  context.snapshot = { sections: {}, pets: { main: { lock: { counter: 1, data: { locked: true, expiresAt: Date.now() + 10000 } } } } };
  context.blockState = new Promise(resolve => { release = resolve; });
  const pending = vm.runInContext('pollStateOnce()', context);
  await settle();
  vm.runInContext('pet.preemptControl()', context);
  release(); await pending;
  assert.ok(reports.some(report => report.url.includes('lock/release') && report.body.force === true));
  assert.equal(Boolean(vm.runInContext('pet.frozen', context)), false);
  vm.runInContext('pet.applyControlLock({locked:false})', context);
}));
