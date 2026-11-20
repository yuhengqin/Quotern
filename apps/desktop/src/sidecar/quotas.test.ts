import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { desktopQuotas } from './quotas';

const ready = () => ({
  status: 'ready', fetchedAt: Math.floor(Date.now() / 1000), stale: false,
  limits: [{ id: 'synthetic-window', label: 'Synthetic window', usedPercent: 37, resetsAt: null }],
});

async function fixture(run: (context: {
  root: string;
  create: (read: Parameters<typeof desktopQuotas>[2]) => ReturnType<typeof desktopQuotas>;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-consent-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  let manager: Awaited<ReturnType<typeof desktopQuotas>> | undefined;
  try {
    await run({ root, create: async read => {
      manager = await desktopQuotas(join(root, 'profile'), () => {}, read, join(root, 'data'));
      return manager;
    } });
  } finally {
    try { await manager?.close(); }
    finally {
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
  }
}

test('providers start disconnected and failed authorization grants no access', async () => {
  await fixture(async ({ create }) => {
    const calls: string[] = [];
    const manager = await create(async id => { calls.push(id); return { status: 'access-denied' }; });
    const initial = manager.getState();
    assert.equal(initial.providers.length, 14);
    assert.ok(initial.providers.every(provider => provider.access?.connected === false && provider.status === 'not-signed-in'));
    await assert.rejects(manager.authorize('codex', undefined), /authorization failed/i);
    assert.equal(manager.getState().providers.find(provider => provider.id === 'codex')?.access?.connected, false);
    await manager.refresh('codex');
    assert.deepEqual(calls, ['codex']);
    assert.equal(manager.getState().providers.find(provider => provider.id === 'codex')?.status, 'not-signed-in');
  });
});

test('DeepSeek secret stays with the reader and disconnect hides its data immediately', async () => {
  await fixture(async ({ root, create }) => {
    const secret = 'synthetic-deepseek-key-1749';
    const calls: unknown[][] = [];
    const manager = await create(async (...args) => { calls.push(args); return ready(); });
    await manager.authorize('deepseek', secret);
    assert.deepEqual(calls, [['deepseek', secret, undefined]]);
    const connected = manager.getState();
    const provider = connected.providers.find(row => row.id === 'deepseek');
    assert.equal(provider?.access?.connected, true);
    assert.equal(provider?.status, 'ready');
    assert.equal(provider?.windows[0]?.usedPercent, 37);
    assert.ok(!JSON.stringify(connected).includes(secret));

    const reportPath = join(root, 'data', 'quota-snapshots', 'desktop.json');
    let report = '';
    for (let attempt = 0; attempt < 200; attempt++) {
      try { report = await readFile(reportPath, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (report && JSON.parse(report).providers.some((row: { id: string; status: string }) => row.id === 'deepseek' && row.status === 'ready')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(report && JSON.parse(report).providers.some((row: { id: string; status: string }) => row.id === 'deepseek' && row.status === 'ready'));
    assert.ok(!report.includes(secret));

    const disconnecting = manager.disconnect('deepseek');
    const disconnected = manager.getState().providers.find(row => row.id === 'deepseek');
    assert.equal(disconnected?.access?.connected, false);
    assert.equal(disconnected?.status, 'not-signed-in');
    assert.deepEqual(disconnected?.windows, []);
    assert.ok(!JSON.stringify(disconnected).includes('synthetic-window'));
    await disconnecting;
    assert.ok(!JSON.stringify(manager.getState()).includes(secret));
  });
});

test('disconnect cancels an authorization that finishes later', async () => {
  await fixture(async ({ create }) => {
    let finish!: (value: unknown) => void;
    const manager = await create(async () => new Promise(resolve => { finish = resolve; }));
    const pending = manager.authorize('codex', undefined);
    await manager.disconnect('codex');
    finish(ready());
    await assert.rejects(pending, /cancelled/i);
    const provider = manager.getState().providers.find(row => row.id === 'codex');
    assert.equal(provider?.access?.connected, false);
    assert.equal(provider?.status, 'not-signed-in');
    assert.deepEqual(provider?.windows, []);
  });
});

test('Codex profiles require separate grants and read their own directories', async () => {
  await fixture(async ({ root, create }) => {
    const calls: unknown[][] = [];
    const manager = await create(async (...args) => { calls.push(args); return ready(); });
    const first = join(root, 'codex-first');
    const second = join(root, 'codex-second');
    await manager.set({ profiles: [
      { id: 'first', provider: 'codex', label: 'First', directory: first, enabled: true },
      { id: 'second', provider: 'codex', label: 'Second', directory: second, enabled: true },
    ] });
    assert.deepEqual(calls, []);
    await manager.authorize('codex@first', undefined);
    assert.deepEqual(calls, [['codex', undefined, first]]);
    let state = manager.getState();
    assert.equal(state.providers.find(row => row.id === 'codex@first')?.access?.connected, true);
    assert.equal(state.providers.find(row => row.id === 'codex@second')?.access?.connected, false);
    assert.equal(state.providers.find(row => row.id === 'codex')?.access?.connected, false);
    await manager.authorize('codex@second', undefined);
    assert.deepEqual(calls, [['codex', undefined, first], ['codex', undefined, second]]);
    state = manager.getState();
    assert.equal(state.providers.find(row => row.id === 'codex@second')?.access?.connected, true);
    assert.equal(state.providers.find(row => row.id === 'codex')?.access?.connected, false);
  });
});
