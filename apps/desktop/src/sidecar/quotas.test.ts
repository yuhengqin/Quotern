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
  create: (read: Parameters<typeof desktopQuotas>[3]) => ReturnType<typeof desktopQuotas>;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-quota-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  let manager: Awaited<ReturnType<typeof desktopQuotas>> | undefined;
  try {
    await run({ root, create: async read => {
      manager = await desktopQuotas(join(root, 'profile'), () => {}, async () => false, read, join(root, 'data'));
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

test('startup queries official CLIs with no saved consent and reports their actual status', async () => {
  await fixture(async ({ create }) => {
    const calls: string[] = [];
    const manager = await create(async id => {
      calls.push(id);
      if (id === 'claude') return { status: 'not-signed-in' };
      if (id === 'copilot') return { status: 'not-installed' };
      return ready();
    });
    manager.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls.sort(), ['claude', 'codex', 'copilot', 'minimax', 'muse']);
    const { providers } = manager.getState();
    assert.equal(providers.length, 14);
    const provider = (id: string) => providers.find(row => row.id === id);
    assert.equal(provider('codex')?.status, 'ready');
    assert.equal(provider('codex')?.access?.connected, true);
    assert.equal(provider('claude')?.status, 'not-signed-in');
    assert.equal(provider('claude')?.access?.connected, false);
    assert.equal(provider('copilot')?.status, 'not-installed');
    assert.equal(provider('cursor')?.access?.connected, false);
    assert.equal(provider('deepseek')?.access?.connected, false);
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

test('a failed API key check leaves the source disconnected', async () => {
  await fixture(async ({ create }) => {
    const manager = await create(async () => ({ status: 'access-denied' }));
    await assert.rejects(manager.authorize('deepseek', 'synthetic-key'), /authorization failed/i);
    const provider = manager.getState().providers.find(row => row.id === 'deepseek');
    assert.equal(provider?.access?.connected, false);
    assert.deepEqual(provider?.windows, []);
  });
});

test('API key connections expire on restart and only key sources accept explicit connections', async () => {
  await fixture(async ({ create }) => {
    const read = async () => ready();
    const first = await create(read);
    await assert.rejects(first.authorize('codex', undefined), /does not accept an API key connection/i);
    await assert.rejects(first.disconnect('codex'), /does not accept an API key connection/i);
    await assert.rejects(first.authorize('cursor', 'synthetic-key'), /does not accept an API key connection/i);
    await first.authorize('deepseek', 'synthetic-session-only-secret');
    await first.close();

    const restarted = await create(read);
    const state = await restarted.refresh(undefined);
    assert.equal(state.providers.find(provider => provider.id === 'codex')?.status, 'ready');
    const keyProvider = state.providers.find(provider => provider.id === 'deepseek');
    assert.equal(keyProvider?.access?.connected, false);
    assert.deepEqual(keyProvider?.windows, []);
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
    const pending = manager.authorize('deepseek', 'synthetic-key');
    await manager.disconnect('deepseek');
    finish(ready());
    await assert.rejects(pending, /cancelled/i);
    const provider = manager.getState().providers.find(row => row.id === 'deepseek');
    assert.equal(provider?.access?.connected, false);
    assert.equal(provider?.status, 'not-signed-in');
    assert.deepEqual(provider?.windows, []);
  });
});

test('enabled Codex profiles automatically read their own directories and follow edits', async () => {
  await fixture(async ({ root, create }) => {
    const calls: unknown[][] = [];
    const manager = await create(async (...args) => { calls.push(args); return ready(); });
    const first = join(root, 'codex-first');
    const second = join(root, 'codex-second');
    const profile = { id: 'first', provider: 'codex' as const, label: 'First', directory: first, enabled: true };
    await manager.set({ profiles: [
      profile,
      { id: 'second', provider: 'codex', label: 'Second', directory: second, enabled: true },
    ] });
    await new Promise<void>(resolve => setImmediate(resolve));
    const codexCalls = () => calls.filter(([id]) => id === 'codex');
    assert.deepEqual(codexCalls(), [['codex', undefined, undefined], ['codex', undefined, first], ['codex', undefined, second]]);
    const state = manager.getState();
    for (const id of ['codex', 'codex@first', 'codex@second']) {
      assert.equal(state.providers.find(row => row.id === id)?.status, 'ready');
    }

    const moved = join(root, 'codex-moved');
    await manager.set({ profiles: [{ ...profile, directory: moved }] });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(codexCalls().at(-1), ['codex', undefined, moved]);
    assert.equal(manager.getState().providers.find(row => row.id === 'codex@first')?.status, 'ready');
    assert.equal(manager.getState().providers.find(row => row.id === 'codex@second'), undefined);
  });
});

test('disabled CLI channels and profiles are skipped after restart', async () => {
  await fixture(async ({ root, create }) => {
    const calls: unknown[][] = [];
    const read: Parameters<typeof desktopQuotas>[3] = async (...args) => { calls.push(args); return ready(); };
    const before = await create(read);
    const disabled = { id: 'disabled', provider: 'claude' as const, label: 'Disabled', directory: join(root, 'claude-disabled'), enabled: false };
    await before.set({ channels: { codex: false }, profiles: [disabled] });
    await before.close();
    calls.length = 0;
    const restarted = await create(read);
    restarted.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(calls.some(([id]) => id === 'claude'));
    assert.ok(calls.every(([id, , directory]) => id !== 'codex' && directory === undefined));
    assert.ok(restarted.getState().providers.every(row => row.id !== 'codex' && row.id !== 'claude@disabled'));
  });
});
