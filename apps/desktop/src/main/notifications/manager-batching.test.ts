import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { NotificationManager } from './manager.js';
import { DEFAULT_NOTIFICATION_PREFERENCES, type DesktopNotice } from '../../shared/notifications.js';

class Native extends EventEmitter { closes = 0; constructor(private readonly autoShow: boolean) { super(); } show() { if (this.autoShow) this.emit('show'); } close() { this.closes++; this.emit('close'); } }
const item = (id: string, alert: 'threshold-90' | 'depleted' | 'reset' = 'threshold-90'): DesktopNotice => ({
  id, category: 'quota', title: id, body: `Body ${id}`, replaceKey: id, snoozable: alert !== 'reset',
  context: { kind: 'quota', alert, resetsAt: null }, target: { kind: 'quota', value: { providerId: id, providerType: 'codex' } },
});
function fixture(autoShow = true) {
  const preferences = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
  const presented: DesktopNotice[] = [], natives: Native[] = [], sounds: string[] = [], clicks: DesktopNotice[] = [];
  let focused = false;
  const manager = new NotificationManager({
    preferences: () => preferences, isSupported: () => true, isFocused: () => focused, retainAfterClose: true,
    create: (_text, value) => { presented.push(value); const native = new Native(autoShow); natives.push(native); return native; },
    sound: async sound => { sounds.push(sound); }, onClick: value => { clicks.push(value); }, onIssue: () => {},
    batch: { delayMs: 1000, summarize: (items: DesktopNotice[]) => ({ id: `summary-${items.map(value => value.id).join('-')}`, category: 'quota', title: `${items.length} notices`, body: items.map(value => value.title).join(', '), target: { kind: 'quota' }, snoozable: items.some(value => value.snoozable !== false) }) },
  });
  return { manager, preferences, presented, natives, sounds, clicks, focus: () => { focused = true; } };
}

test('a fixed window merges scopes, replaces a pending scope and plays only one sound', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  const old = f.manager.send(item('a'));
  t.mock.timers.tick(600);
  const latest = f.manager.send({ ...item('a-new'), replaceKey: 'a' });
  const other = f.manager.send(item('b'));
  assert.equal(await old, 'suppressed');
  assert.equal(f.presented.length, 0);
  t.mock.timers.tick(400);
  assert.equal(f.presented.length, 1);
  assert.equal(f.presented[0]!.body, 'a-new, b');
  assert.deepEqual(await Promise.all([latest, other]), ['shown', 'shown']);
  assert.deepEqual(f.sounds, ['soft']);
  assert.equal(f.manager.count, 2);
  assert.equal(await f.manager.send(item('b')), 'suppressed');
});

test('depletion and critical outages bypass batching while a single ordinary item keeps its exact target', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  const ordinary = f.manager.send(item('ordinary'));
  assert.equal(await f.manager.send(item('urgent', 'depleted')), 'shown');
  assert.equal(await f.manager.send({ ...item('service'), category: 'service', context: { kind: 'service', level: 'critical', selection: 'null', label: 'Service' } }), 'shown');
  assert.equal(f.presented.length, 2);
  t.mock.timers.tick(1000); assert.equal(await ordinary, 'shown');
  assert.deepEqual(f.presented[2]!.target, item('ordinary').target);
});

test('clear removes active history, pending work and snoozed work without muting future events', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  await f.manager.send(item('deferred', 'depleted'));
  f.manager.activate('deferred', 'snooze');
  await f.manager.send(item('visible', 'depleted'));
  f.natives.at(-1)!.emit('close');
  const pending = f.manager.send(item('pending'));
  assert.equal(f.manager.count, 3);
  f.manager.clear();
  assert.equal(await pending, 'suppressed');
  assert.equal(f.manager.count, 0);
  t.mock.timers.tick(30 * 60_000);
  assert.equal(f.presented.length, 2);
  f.natives.forEach(value => { value.emit('show'); value.emit('click'); });
  assert.equal(f.clicks.length, 0); assert.equal(f.sounds.length, 2);
  assert.equal(await f.manager.send(item('future', 'depleted')), 'shown');
});

test('partial invalidation retains the other summary members without a repeated sound', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  const first = f.manager.send(item('a')), second = f.manager.send(item('b'));
  t.mock.timers.tick(1000); await Promise.all([first, second]);
  f.manager.dismiss(value => value.id === 'a');
  t.mock.timers.tick(1000);
  assert.equal(f.natives[0]!.closes, 1);
  assert.equal(f.presented.at(-1)!.id, 'b');
  assert.deepEqual(f.sounds, ['soft']);
  f.natives.at(-1)!.emit('click'); assert.deepEqual(f.clicks[0]!.target, item('b').target);
});

test('policy and expiry are checked per member while queued and after aggregation', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  const expired = f.manager.send({ ...item('expired'), expiresAt: 10500 });
  const kept = f.manager.send(item('kept'));
  t.mock.timers.tick(1000);
  assert.equal(await expired, 'suppressed'); assert.equal(await kept, 'shown');
  assert.equal(f.presented[0]!.id, 'kept');
  const service = f.manager.send({ ...item('service'), category: 'service' });
  f.preferences.modes.service = 'off'; f.manager.reconcile();
  assert.equal(await service, 'suppressed');
  f.preferences.modes.quota = 'background'; f.focus(); f.manager.reconcile();
  assert.equal(f.manager.count, 0);
});

test('summary snooze keeps per-scope reminders and never reschedules reset/recovery notices', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  const first = f.manager.send(item('a')), reset = f.manager.send(item('reset', 'reset'));
  t.mock.timers.tick(1000); await Promise.all([first, reset]);
  const summary = f.presented[0]!;
  assert.equal(f.manager.activate(summary.id, 'snooze'), true);
  assert.equal(f.manager.count, 1);
  t.mock.timers.tick(30 * 60_000); t.mock.timers.tick(1000);
  assert.equal(f.presented.at(-1)!.id, 'a');
  assert.equal(f.manager.activate(summary.id, 'view'), false);
});

test('native clear-all follows the actual action list, including a non-snoozable notice', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(); t.after(() => f.manager.dispose());
  await f.manager.send(item('urgent', 'depleted'));
  const reset = f.manager.send(item('reset', 'reset')); t.mock.timers.tick(1000); await reset;
  assert.deepEqual(f.presented.at(-1)!.actions, ['view', 'dismiss-all']);
  f.natives.at(-1)!.emit('action', {}, 1);
  assert.equal(f.manager.count, 0); assert.equal(f.clicks.length, 0);
});

test('partial retraction before the first native show keeps the survivor delivery and initial sound', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(false); t.after(() => f.manager.dispose());
  const removed = f.manager.send(item('a')), survivor = f.manager.send(item('b'));
  let result: string | null = null; void survivor.then(value => { result = value; });
  t.mock.timers.tick(1000);
  f.manager.dismiss(value => value.id === 'a');
  assert.equal(await removed, 'suppressed');
  await Promise.resolve(); assert.equal(result, null);
  t.mock.timers.tick(1000); f.natives[0]!.emit('show');
  assert.deepEqual(f.sounds, []);
  f.natives[1]!.emit('show');
  assert.equal(await survivor, 'shown'); assert.deepEqual(f.sounds, ['soft']);
});
