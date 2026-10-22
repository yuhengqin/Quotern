import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { prepareDshPet } from './prepare-dsh-pet.mjs';

class Element extends EventTarget {
  style = {}; children = []; attributes = {}; classes = new Set();
  classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), toggle: (n, value) => value ? this.classes.add(n) : this.classes.delete(n) };
  set textContent(text) { this.text = text; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
  set innerHTML(_) { this.text = ''; this.children = []; }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
}

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-companion-'));
  const storage = new Map(), timers = new Map(), requests = []; let seq = 0;
  const later = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };
  const cancel = id => timers.delete(id);
  try {
    await prepareDshPet({ outputRoot: root });
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Event, AbortController, URLSearchParams, Date, performance,
      setTimeout: later, clearTimeout: cancel, requestAnimationFrame: fn => later(() => fn(performance.now() + 250), 16), cancelAnimationFrame: cancel,
      window: { __dshPetDebug: {}, setTimeout: later, clearTimeout: cancel, addEventListener() {}, matchMedia: () => ({ matches: false }), localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val), removeItem: key => storage.delete(key) } },
      document: { createElement: () => new Element(), querySelectorAll: () => [] }, Element,
      fetch: async (url, options) => { requests.push(String(url)); return { ok: true, json: async () => String(url).endsWith('/state') ? context.snapshot : { ok: true } }; },
      sprites: [], STATE_URL: '/state', BASE: '/pet', VIEW: { x: 0, y: 0, w: 1000, h: 800 }, WORK_AREAS: [{ x: 0, y: 0, width: 1000, height: 800 }], AREAS: [{ x: 0, y: 0, width: 1000, height: 800 }],
      CONFIG: { scale: 1, topInsetRatio: 0 }, toLocal: n => n, toScreen: n => n,
    });
    vm.runInContext(await readFile(path.join(root, 'runtime/shared-core.js'), 'utf8'), context);
    vm.runInContext(`const S = PetShared; const config = {}; const OPEN_TARGET = 'desktop'; const ORIGIN = '';\n${await readFile(path.join(root, 'runtime/sprite.js'), 'utf8')}`, context);
    vm.runInContext(await readFile(path.join(root, 'runtime/events.js'), 'utf8'), context);
    vm.runInContext(await readFile(path.join(root, 'runtime/controls.js'), 'utf8'), context);
    const html = await readFile(path.join(root, 'runtime/index.html'), 'utf8');
    if (html.includes('./interactions.js')) vm.runInContext(await readFile(path.join(root, 'runtime/interactions.js'), 'utf8'), context);
    vm.runInContext(`const pet = Object.assign(Object.create(PetSprite.prototype), {
      pet: { id: 'main', name: '大肥鱼', workStatusEnabled: true }, pos: {x:100,y:300}, size: 200, height:112.5, halfW:100, halfH:56.25, bottomPad:0, winH:112.5,
      hitRect:{x:62.5,y:10,w:75,h:90}, margin:{l:100,r:100,t:200,b:100}, assetBase:'/assets/', facing:'left', gen:0, front:0,
      dragState:{active:false,dragging:false}, throwRef:null, moveRef:null, pendingMove:null, stage:new Element(), el:new Element(), hit:new Element(), tip:new Element(), bubble:new Element(),
      videoA:{pause(){}},videoB:{pause(){}},
      animations:{idle:['idle'],turn:[],drag:['drag'],clicks:['one','two','three'],moves:{actions:[]},categories:[{actions:['哈欠连天','原地小憩沉眠','打瞌睡被惊醒']}],events:{workStatus:['think','work','result','wait','success','error']}},
      played:[], playOnce(name){this.anim=name; this.played.push(name);}, switchTo(name,once){this.anim=name;this.once=once;this.played.push(name);},
      stopMove(){this.moveRef=null;},stopThrow(){this.throwRef=null;},stopDragFollow(){}, syncInputBusy(){},syncInputRegions(){},
      sendBounds(x,y){this.pos={x,y};},renderTip(){},closeMenu(){this.menuOpen=false;},position(){},ac:new AbortController()
    }); sprites.push(pet); pet.initCompanion?.();`, context);
    const evaluate = code => vm.runInContext(code, context);
    await run({ evaluate, context, storage, requests, timers, html });
    evaluate('pet.disposeCompanion?.()');
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('click cycles every configured response, shows fresh statistics and preserves flight scoring', async () => fixture(({ evaluate }) => {
  evaluate(`pet.onCompanionSnapshot?.({connected:true,syncing:false,hoverText:'Today 42',quips:['Today 42','Seven days 100']}); pet.onClick(); pet.onClick(); pet.onClick(); pet.onClick();`);
  assert.deepEqual(Array.from(evaluate('pet.played')), ['one', 'two', 'three', 'one']);
  assert.match(evaluate('pet.bubble.textContent'), /Seven days 100/);
  evaluate(`pet.pressScoreFired=true; pet.onClick();`);
  assert.equal(evaluate('pet.played.length'), 4, 'catching a flying pet must not add a second click animation');
  evaluate(`pet.justDragged=true; pet.onClick();`);
  assert.equal(evaluate('pet.played.length'), 4, 'drag release must not become a click');
}));

test('hover shows usage, lean leaves the stage transform intact and urgent bubbles retain priority', async () => fixture(({ evaluate }) => {
  evaluate(`pet.stage.style.transform='translateY(8px)'; pet.onCompanionSnapshot?.({connected:true,syncing:false,hoverText:'Today 42',quips:['42']}); pet.onMouseMove({clientX:pet.margin.l+pet.hitRect.x+pet.hitRect.w*.8,clientY:250,buttons:0});`);
  assert.equal(evaluate('pet.bubble.textContent'), 'Today 42');
  assert.notEqual(evaluate('pet.stage.style.rotate'), '0deg');
  assert.equal(evaluate('pet.stage.style.transform'), 'translateY(8px)');
  evaluate(`pet.workOn=true; pet.workState='error';pet.workText='Real error';pet.renderBubble();`);
  assert.equal(evaluate('pet.bubble.textContent'), 'Real error');
  evaluate(`pet.workOn=false; pet.onMouseMove({clientX:0,clientY:0,buttons:0});`);
  assert.equal(evaluate('pet.stage.style.rotate'), '0deg');
  evaluate(`window.matchMedia=()=>({matches:true});pet.onMouseMove({clientX:pet.margin.l+pet.hitRect.x+pet.hitRect.w*.8,clientY:250,buttons:0});`);
  assert.equal(evaluate('pet.stage.style.rotate'), '0deg');
}));

test('sleep and wake use real animation endings and yield to work and control', async () => fixture(({ evaluate }) => {
  evaluate(`pet.setCompanionIdle?.(true);`);
  assert.equal(evaluate('pet.anim'), '哈欠连天');
  evaluate('pet.handleEnded()');
  assert.equal(evaluate('pet.anim'), '原地小憩沉眠');
  assert.equal(evaluate('pet.once'), false);
  evaluate('pet.setCompanionIdle(false)');
  assert.equal(evaluate('pet.anim'), '打瞌睡被惊醒');
  evaluate('pet.workState="working";pet.setCompanionIdle(true)');
  assert.notEqual(evaluate('pet.companionPhase'), 'sleep');
  evaluate('pet.workState=null;pet.controlPlayback="manual";pet.setCompanionIdle(true)');
  assert.notEqual(evaluate('pet.companionPhase'), 'sleep');
}));

test('dock exposes hittable body, expands without losing hover, restores and exits on explicit movement', async () => fixture(({ evaluate, context, storage }) => {
  evaluate(`pet.pos={x:860,y:300}; pet.tryCompanionDock?.();`);
  assert.ok(evaluate('pet.companionDock'));
  evaluate('pet.setCompanionExpanded(false, false)');
  assert.equal(evaluate('pet.pos.x+pet.hitRect.x'), 982);
  evaluate('pet.setCompanionExpanded(true, false)');
  assert.equal(evaluate('pet.pos.x+pet.hitRect.x+pet.hitRect.w'), 1000);
  assert.equal(evaluate('pet.tryMove()'), false, 'docked pets must not wander away');
  assert.ok(storage.size > 0);
  evaluate('pet.companionDock=null;pet.restoreCompanionPosition()');
  assert.ok(evaluate('pet.companionDock'));
  evaluate(`pet.moveToCenter(.2,.5,'instant')`);
  assert.equal(Boolean(evaluate('pet.companionDock')), false);
  assert.equal(evaluate('pet.pos.x+pet.halfW'), 200);
  context.WORK_AREAS.push({x:1000,y:0,width:1000,height:800});
  evaluate('pet.pos={x:860,y:300};pet.tryCompanionDock()');
  assert.equal(Boolean(evaluate('pet.companionDock')), false, 'an interior monitor seam must not hide the character onto its neighbour');
}));

test('companion state arrives on the first shared poll without replaying old events', async () => fixture(async ({ evaluate, context, html }) => {
  assert.match(html, /controls\.js[\s\S]*interactions\.js[\s\S]*renderer\.js/);
  context.snapshot = {sections:{companion:{counter:1,data:{connected:true,syncing:false,hoverText:'Live usage',quips:['Live usage']}}},pets:{}};
  await evaluate('pollStateOnce()');
  assert.equal(evaluate('pet.companionData.hoverText'), 'Live usage');
}));

test('a click bubble stays inside the workspace while the dock closes', async () => fixture(({ evaluate }) => {
  evaluate(`pet.pos={x:860,y:300};pet.tryCompanionDock();pet.setCompanionExpanded(true,false);pet.bubble.getBoundingClientRect=()=>({width:240,height:60});pet.showCompanionText('A visible click bubble');pet.setCompanionExpanded(false,false);`);
  assert.ok(evaluate('pet.pos.x+parseFloat(pet.bubble.style.left)+120 <= 992'), 'the speech card must be re-clamped after the body moves');
}));

test('a control lock cancels a pending slide and suppresses hover motion until user takeover', async () => fixture(({ evaluate, timers }) => {
  evaluate(`pet.pos={x:860,y:300};pet.tryCompanionDock();pet.setCompanionExpanded(true);pet.applyControlLock({locked:true,expiresAt:Date.now()+10000});`);
  assert.equal(Boolean(evaluate('pet.companionSlide')), false);
  const before = evaluate('pet.pos.x');
  evaluate(`pet.setCompanionHover(true,1);`);
  assert.equal(evaluate('pet.stage.style.rotate'), '0deg');
  for (const [id, timer] of timers) if (timer.ms === 16) { timers.delete(id); timer.fn(); }
  assert.equal(evaluate('pet.pos.x'), before);
}));

test('saved docking pins to the new screen edge after the desktop width changes', async () => fixture(({ evaluate, context }) => {
  evaluate('pet.pos={x:860,y:300};pet.tryCompanionDock();');
  context.VIEW.w = 2000; context.WORK_AREAS[0].width = 2000; context.AREAS[0].width = 2000;
  evaluate('pet.relayout()');
  assert.equal(Boolean(evaluate('pet.companionDock')), true);
  evaluate('pet.setCompanionExpanded(true,false)');
  assert.equal(evaluate('pet.pos.x+pet.hitRect.x+pet.hitRect.w'), 2000);
}));

test('a click during mouse-idle sleep returns to the automatic rest state after its video ends', async () => fixture(({ evaluate }) => {
  evaluate('pet.setCompanionIdle(true);pet.onClick();');
  assert.equal(evaluate('pet.anim'), 'one');
  evaluate('pet.handleEnded()');
  assert.equal(evaluate('pet.anim'), '哈欠连天');
}));
