import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const path of ['./dashboard-refresh.ts', '../../../../apps/desktop/src/renderer/lib/dashboard-refresh.ts']) {
  test(`${path}: frozen demos suppress automatic refresh; live clients refresh and clean up`, async () => {
    const mod = await import(path) as Record<string, any>;
    assert.equal(typeof mod.subscribeAutomaticRefresh, 'function');
    const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const events = new EventTarget();
    const visibility = new EventTarget();
    const intervals = new Map<number, () => void>();
    let nextId = 0;
    Object.assign(events, {
      setInterval: (callback: () => void) => { const id = ++nextId; intervals.set(id, callback); return id; },
      clearInterval: (id: number) => intervals.delete(id),
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: visibility });
    try {
      let polls = 0, resumes = 0;
      const poll = () => { polls++; };
      const onFocus = () => { resumes++; };
      const stopDemo = mod.subscribeAutomaticRefresh(poll, { readOnly: true, onFocus });
      assert.equal(intervals.size, 0);
      events.dispatchEvent(new Event('focus'));
      visibility.dispatchEvent(new Event('visibilitychange'));
      assert.deepEqual([polls, resumes], [0, 0]);
      // Explicit refresh stays available to the caller in frozen mode.
      poll();
      assert.equal(polls, 1);
      stopDemo();

      const stopLive = mod.subscribeAutomaticRefresh(poll, { onFocus });
      assert.equal(intervals.size, 1);
      for (const callback of intervals.values()) callback();
      events.dispatchEvent(new Event('focus'));
      visibility.dispatchEvent(new Event('visibilitychange'));
      assert.deepEqual([polls, resumes], [2, 2]);
      stopLive();
      assert.equal(intervals.size, 0);
      events.dispatchEvent(new Event('focus'));
      visibility.dispatchEvent(new Event('visibilitychange'));
      assert.deepEqual([polls, resumes], [2, 2]);
    } finally {
      if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
      if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
    }
  });
}
