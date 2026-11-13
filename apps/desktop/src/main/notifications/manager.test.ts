import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { NotificationManager } from './manager.js';
import { DEFAULT_NOTIFICATION_PREFERENCES, type DesktopNotice } from '../../shared/notifications.js';

class NativeNotice extends EventEmitter { closes = 0; shows = 0; show() { this.shows++; } close() { this.closes++; this.emit('close'); } }
const notice: DesktopNotice = { id: 'one', category: 'quota', title: 'Agent', body: 'Check', sessionKey: 'codex:s', requestId: 'r', target: { kind: 'session', value: { source: 'codex', sessionId: 's' } } };
function fixture(retainAfterClose = false, resolveNotice?: (notice: DesktopNotice) => DesktopNotice | null) {
  const preferences = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES), natives: NativeNotice[] = [], sounds: string[] = [], clicks: DesktopNotice[] = [];
  let focused = false;
  const manager = new NotificationManager({ preferences: () => preferences, isFocused: () => focused, isSupported: () => true,
    create: () => { const value = new NativeNotice(); natives.push(value); return value; }, sound: async sound => { sounds.push(sound); }, onClick: value => { clicks.push(value); }, onIssue: () => {}, retainAfterClose, ...(resolveNotice ? { resolveNotice } : {}) });
  return { manager, preferences, natives, sounds, clicks, focus: (value: boolean) => focused = value };
}
test('delivery respects category policy; only a confirmed native show plays a sound', async () => {
  const f = fixture(); f.focus(true);
  f.preferences.modes.quota = 'background';
  assert.equal(await f.manager.send(notice), 'suppressed'); assert.equal(f.natives.length, 0);
  f.preferences.modes.quota = 'always';
  const pending = f.manager.send(notice); assert.equal(f.sounds.length, 0); assert.equal(f.natives.length, 1);
  f.natives[0]!.emit('show'); assert.equal(await pending, 'shown'); assert.deepEqual(f.sounds, ['soft']);
  f.natives[0]!.emit('show'); assert.equal(f.sounds.length, 1);
  assert.equal(await f.manager.send(notice), 'suppressed');
  f.preferences.modes.service = 'off';
  assert.equal(await f.manager.send({ ...notice, id: 'two', category: 'service' }), 'suppressed');
  f.manager.dispose();
});
test('retired Agent categories cannot send notifications even through the test bypass', async () => {
  const f = fixture();
  for (const category of ['agentComplete', 'agentConfirmation', 'agentError']) {
    assert.equal(await f.manager.send({ ...notice, category } as unknown as DesktopNotice, true), 'suppressed');
  }
  assert.equal(f.natives.length, 0);
  assert.deepEqual(f.sounds, []);
  f.manager.dispose();
});
test('click opens the exact target; resolving one request leaves another session alone', async () => {
  const f = fixture();
  const first = f.manager.send(notice), second = f.manager.send({ ...notice, id: 'two', sessionKey: 'claude:other' });
  assert.equal(f.natives.length, 2);
  f.natives.forEach(value => value.emit('show')); await Promise.all([first, second]);
  f.manager.dismiss(value => value.sessionKey === 'codex:s' && value.requestId === 'r');
  assert.equal(f.natives[0]!.closes, 1); assert.equal(f.natives[1]!.closes, 0);
  f.natives[1]!.emit('click'); assert.equal(f.clicks[0]!.target?.kind, 'session');
  f.manager.dispose();
});
test('native failure is retryable and dismissed/disposed late events never play audio', async () => {
  const f = fixture(); const failed = f.manager.send(notice);
  assert.equal(f.natives.length, 1);
  f.natives[0]!.emit('failed'); await assert.rejects(failed);
  const retried = f.manager.send(notice); f.manager.dismiss(() => true);
  assert.equal(await retried, 'suppressed'); f.natives[1]!.emit('show'); assert.equal(f.sounds.length, 0);
  const last = f.manager.send({ ...notice, id: 'last' }); f.manager.dispose();
  assert.equal(await last, 'suppressed'); f.natives[2]!.emit('show'); assert.equal(f.sounds.length, 0);
});

test('an explicit test keeps its policy bypass when window focus changes', async () => {
  const f = fixture();
  f.preferences.modes.quota = 'off';
  const pending = f.manager.send(notice, true);
  f.focus(true);
  f.manager.reconcile();
  assert.equal(f.natives[0]!.closes, 0);
  f.natives[0]!.emit('show');
  assert.equal(await pending, 'shown');
  f.manager.dispose();
});

test('Windows timeout retains history click and retraction until the request is resolved', async () => {
  const f = fixture(true), pending = f.manager.send(notice);
  f.natives[0]!.emit('show'); await pending;
  f.natives[0]!.emit('close'); // Windows banner timeout: still in Action Center.
  f.natives[0]!.emit('click');
  assert.equal(f.clicks.length, 1);
  f.manager.dismiss(value => value.requestId === 'r');
  assert.equal(f.natives[0]!.closes, 1);
  f.natives[0]!.emit('click'); assert.equal(f.clicks.length, 1);
  const second = f.manager.send({ ...notice, id: 'second' });
  f.natives[1]!.emit('show'); await second; f.natives[1]!.emit('close');
  f.manager.dispose(); assert.equal(f.natives[1]!.closes, 1);
});

test('expired notices never show and a live notice retracts when its validity ends', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(true); t.after(() => f.manager.dispose());
  const expired = { ...notice, expiresAt: 9999 };
  const result = f.manager.send(expired);
  assert.equal(f.natives.length, 0);
  assert.equal(await result, 'suppressed');
  const live = f.manager.send({ ...notice, id: 'live', expiresAt: 11000 } as DesktopNotice);
  f.natives[0]!.emit('show'); await live;
  t.mock.timers.tick(1000);
  assert.equal(f.natives[0]!.closes, 1);
});

test('snooze resends the latest notice for that scope, while another scope stays active', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(true); t.after(() => f.manager.dispose());
  const first = f.manager.send({ ...notice, replaceKey: 'account-a' });
  const other = f.manager.send({ ...notice, id: 'other', replaceKey: 'account-b' });
  f.natives.forEach(value => value.emit('show')); await Promise.all([first, other]);
  f.manager.activate('one', 'snooze');
  assert.equal(f.natives[0]!.closes, 1); assert.equal(f.natives[1]!.closes, 0);
  assert.equal(await f.manager.send({ ...notice, id: 'newest', body: '100%', replaceKey: 'account-a' }), 'suppressed');
  t.mock.timers.tick(30 * 60_000 - 1); assert.equal(f.natives.length, 2);
  t.mock.timers.tick(1); assert.equal(f.natives.length, 3);
  f.natives[2]!.emit('show'); f.natives[2]!.emit('click');
  assert.equal(f.clicks.at(-1)?.id, 'newest');
});

test('resolving or disabling a snoozed scope cancels its deferred reminder', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(true); t.after(() => f.manager.dispose());
  const pending = f.manager.send({ ...notice, replaceKey: 'account-a' });
  f.natives[0]!.emit('show'); await pending;
  f.manager.activate('one', 'snooze');
  f.manager.dismiss(value => value.replaceKey === 'account-a');
  t.mock.timers.tick(30 * 60_000); assert.equal(f.natives.length, 1);
});

test('disabling a policy cancels a snooze and late actions cannot open the dismissed notice', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(true); t.after(() => f.manager.dispose());
  const pending = f.manager.send({ ...notice, replaceKey: 'account-a' }); f.natives[0]!.emit('show'); await pending;
  f.manager.activate('one', 'snooze');
  f.preferences.modes.quota = 'off'; f.manager.reconcile();
  t.mock.timers.tick(30 * 60_000);
  assert.equal(f.natives.length, 1); assert.equal(f.manager.activate('one', 'view'), false); assert.equal(f.clicks.length, 0);
});

test('a deferred reminder resolves its content from the latest state before sending', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const f = fixture(true, value => ({ ...value, body: 'Component B is affected now' })); t.after(() => f.manager.dispose());
  const pending = f.manager.send({ ...notice, body: 'Component A was affected', replaceKey: 'service' }); f.natives[0]!.emit('show'); await pending;
  f.manager.activate('one', 'snooze'); t.mock.timers.tick(30 * 60_000);
  f.natives[1]!.emit('show'); f.natives[1]!.emit('click');
  assert.equal(f.clicks.at(-1)?.body, 'Component B is affected now');
});
