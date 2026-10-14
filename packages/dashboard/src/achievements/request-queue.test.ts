import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAchievementRequestQueue } from './request-queue.ts';

test('preference mutations and background reads reach the server in one client order even under lock contention', async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let value = 'old';
  const started: string[] = [];
  const run = createAchievementRequestQueue(async (operation: string) => {
    started.push(operation);
    if (operation === 'save') { await waiting; value = 'new'; }
    return value;
  });
  const save = run('save'), refresh = run('refresh');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(started, ['save']);
  release();
  assert.equal(await save, 'new');
  assert.equal(await refresh, 'new');
  assert.deepEqual(started, ['save', 'refresh']);
});

test('a rejected achievement request releases the queue for retry and following operations', async () => {
  const run = createAchievementRequestQueue(async (value: number) => { if (value === 0) throw new Error('offline'); return value; });
  const failed = run(0), later = run(2);
  await assert.rejects(failed, /offline/);
  assert.equal(await later, 2);
});
