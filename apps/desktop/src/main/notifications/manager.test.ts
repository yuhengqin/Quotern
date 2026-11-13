import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { NotificationManager } from './manager.js';
import { DEFAULT_NOTIFICATION_PREFERENCES, type DesktopNotice } from '../../shared/notifications.js';

class NativeNotice extends EventEmitter { closes = 0; shows = 0; show() { this.shows++; } close() { this.closes++; this.emit('close'); } }
const notice: DesktopNotice = { id: 'one', category: 'agentConfirmation', title: 'Agent', body: 'Check', sessionKey: 'codex:s', requestId: 'r', target: { kind: 'session', value: { source: 'codex', sessionId: 's' } } };
function fixture(retainAfterClose = false) {
  const preferences = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES), natives: NativeNotice[] = [], sounds: string[] = [], clicks: DesktopNotice[] = [];
  let focused = false;
  const manager = new NotificationManager({ preferences: () => preferences, isFocused: () => focused, isSupported: () => true,
    create: () => { const value = new NativeNotice(); natives.push(value); return value; }, sound: async sound => { sounds.push(sound); }, onClick: value => { clicks.push(value); }, onIssue: () => {}, retainAfterClose });
  return { manager, preferences, natives, sounds, clicks, focus: (value: boolean) => focused = value };
}
test('delivery respects category policy; only a confirmed native show plays a sound', async () => {
  const f = fixture(); f.focus(true);
  assert.equal(await f.manager.send(notice), 'suppressed'); assert.equal(f.natives.length, 0);
  f.preferences.modes.agentConfirmation = 'always';
  const pending = f.manager.send(notice); assert.equal(f.sounds.length, 0); assert.equal(f.natives.length, 1);
  f.natives[0]!.emit('show'); assert.equal(await pending, 'shown'); assert.deepEqual(f.sounds, ['soft']);
  f.natives[0]!.emit('show'); assert.equal(f.sounds.length, 1);
  assert.equal(await f.manager.send(notice), 'suppressed');
  f.preferences.modes.agentError = 'off';
  assert.equal(await f.manager.send({ ...notice, id: 'two', category: 'agentError' }), 'suppressed');
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
  f.preferences.modes.agentConfirmation = 'off';
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
