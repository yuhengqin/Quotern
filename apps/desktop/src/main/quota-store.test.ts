import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openQuotaStore } from './quota-store';

test('corrupt preferences never re-enable alerts or overwrite the unreadable document', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quotern-quota-'));
  try {
    await writeFile(path.join(directory, 'preferences.json'), '{broken');
    const store = await openQuotaStore(directory);
    assert.equal(store.preferences.thresholdAlerts, false);
    assert.equal(store.preferences.resetAlerts, false);
    await assert.rejects(store.savePreferences(store.preferences));
    assert.equal(await readFile(path.join(directory, 'preferences.json'), 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('opening the store prunes expired history even if every channel stays disabled', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quotern-quota-'));
  try {
    await writeFile(path.join(directory, 'history.json'), JSON.stringify({ old: [{ at: 1, usedPercent: 50, resetsAt: null }] }));
    const store = await openQuotaStore(directory);
    assert.deepEqual(store.history, {});
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'history.json'), 'utf8')), {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});
