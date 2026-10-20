import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecoverableSync } from './sync-recovery.js';

test('a failed round recovers committed disk updates even when the next round has no delta', async () => {
  const disk: string[] = [], memory: string[] = [];
  let rounds = 0;
  const run = createRecoverableSync({
    run: async () => { if (++rounds === 1) { disk.push('committed'); throw new Error('worker exited'); } return [] as string[]; },
    apply: async results => { memory.push(...results); },
    recover: async () => { memory.splice(0, memory.length, ...disk); },
  });
  await assert.rejects(run('poll'), /worker exited/);
  assert.deepEqual(memory, ['committed']);
  assert.deepEqual(await run('poll'), []);
  assert.deepEqual(memory, ['committed']);
});

test('failed recovery remains required before another writer starts', async () => {
  let runs = 0, recoveries = 0;
  const run = createRecoverableSync({
    run: async () => { if (++runs === 1) throw new Error('worker exited'); return ['current']; },
    apply: async () => {},
    recover: async () => { if (++recoveries < 3) throw new Error('disk unavailable'); },
  });
  await assert.rejects(run('poll'), /worker exited/);
  await assert.rejects(run('poll'), /disk unavailable/);
  assert.equal(runs, 1);
  assert.deepEqual(await run('poll'), ['current']);
  assert.equal(recoveries, 3);
});

test('callers share the whole run and apply transaction without a normal full reload', async () => {
  let finish!: (value: string[]) => void;
  let applications = 0, recoveries = 0;
  const pending = new Promise<string[]>(resolve => { finish = resolve; });
  const run = createRecoverableSync({
    run: () => pending,
    apply: async () => { applications++; }, recover: async () => { recoveries++; },
  });
  const first = run('poll'), second = run('manual');
  finish(['delta']);
  assert.deepEqual(await first, ['delta']); assert.deepEqual(await second, ['delta']);
  assert.equal(applications, 1); assert.equal(recoveries, 0);
});
