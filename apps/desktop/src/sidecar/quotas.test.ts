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

test('desktop registers its profile directory as the account launch source', async () => {
  await fixture(async ({ root, create }) => {
    const manager = await create(async () => ready());
    const sources = JSON.parse(await readFile(join(root, 'data', 'account-launch', 'sources.json'), 'utf8'));
    assert.equal(sources.desktop.directory, manager.directory);
    assert.equal(sources.cli, undefined);
  });
});

test('a confirmed official CLI authorization is restored on restart until disconnected', async () => {
  await fixture(async ({ create }) => {
    const read = async () => ready();
    const first = await create(read);
    await first.authorize('codex', undefined);
    await first.authorize('deepseek', 'synthetic-session-only-secret');
    await first.close();

    const restarted = await create(read);
    const access = (key: string) => restarted.getState().providers.find(provider => provider.id === key)?.access?.connected;
    assert.equal(access('codex'), true);
    assert.equal(access('deepseek'), false);
    assert.equal((await restarted.refresh('codex')).providers.find(provider => provider.id === 'codex')?.status, 'ready');
    await restarted.disconnect('codex');
    await restarted.close();

    const disconnected = await create(read);
    assert.equal(disconnected.getState().providers.find(provider => provider.id === 'codex')?.access?.connected, false);
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

test('restart retains CLI consent only for the same enabled account directory', async () => {
  await fixture(async ({ root, create }) => {
    const original = { id: 'first', provider: 'codex', label: 'First', directory: join(root, 'old'), enabled: true };
    const read = async () => ready();
    const before = await create(read);
    await before.set({ profiles: [original] });
    await before.authorize('codex@first', undefined);
    await before.close();
    const current = await create(read);
    const authorized = () => current.getState().providers.find(row => row.id === 'codex@first')?.access?.connected;
    assert.equal(authorized(), true);
    await current.set({ profiles: [{ ...original, directory: join(root, 'new') }] });
    assert.equal(authorized(), false);
    await current.set({ profiles: [original] });
    assert.equal(authorized(), false);
    await current.authorize('codex@first', undefined);
    await current.set({ profiles: [{ ...original, enabled: false }] });
    await current.close();
    const restarted = await create(read);
    await restarted.set({ profiles: [original] });
    assert.equal(restarted.getState().providers.find(row => row.id === 'codex@first')?.access?.connected, false);
  });
});
