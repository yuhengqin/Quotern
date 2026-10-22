import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { installPositionStore } = createRequire(import.meta.url)('./dsh-pet-position-store.cjs');

test('placement is durable before acknowledgement and only the owning main frame can read or write it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-companion-position-'));
  const handlers = new Map(), sender = { mainFrame: {} };
  const event = () => {
    let replied = false, reply;
    return { sender, senderFrame: sender.mainFrame,
      get returnValue() { return reply; },
      set returnValue(value) { assert.equal(replied, false, 'Electron sends a sync IPC reply immediately on the first assignment'); replied = true; reply = value; },
    };
  };
  const state = { version: 1, rx: .9, ry: .5, docked: true };
  try {
    const install = () => installPositionStore({ app: { getPath: () => root }, ipcMain: { on: (channel, fn) => handlers.set(channel, fn) }, getWindow: id => id === 'main' ? { webContents: sender } : undefined });
    install();
    const write = event(); handlers.get('pet:save-companion-position')(write, 'main', state);
    assert.equal(write.returnValue, true);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'companion-position.json'), 'utf8')).main, state);
    install();
    const read = event(); handlers.get('pet:read-companion-position')(read, 'main'); assert.deepEqual(read.returnValue, state);
    for (const [e, id, value] of [[{ sender: {}, senderFrame: sender.mainFrame }, 'main', state], [event(), 'unknown', state], [event(), 'main', { ...state, rx: Infinity }]]) {
      handlers.get('pet:save-companion-position')(e, id, value); assert.equal(e.returnValue, false);
    }
    const clear = event(); handlers.get('pet:save-companion-position')(clear, 'main', null); assert.equal(clear.returnValue, true);
    const after = event(); handlers.get('pet:read-companion-position')(after, 'main'); assert.equal(after.returnValue, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
