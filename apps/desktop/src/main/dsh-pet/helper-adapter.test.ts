import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DshPetRpcServer } from './rpc.js';
import { connectHost, createPointerSampler, fileResponse } from './helper-adapter.js';
test('cursor sampling preserves hover and exit without forwarding desktop mouse traffic', () => {
  const sample = createPointerSampler(), bounds = { x: 100, y: 200 };
  assert.equal(sample(bounds, { x: 0, y: 0 }, false, false), null);
  assert.deepEqual(sample(bounds, { x: 130, y: 240 }, true, false), { x: 30, y: 40 });
  assert.equal(sample(bounds, { x: 130, y: 240 }, true, false), null);
  assert.deepEqual(sample(bounds, { x: 130, y: 240 }, false, false), { x: 30, y: 40 }, 'resizing may change the hit zone at the same local point');
  assert.deepEqual(sample(bounds, { x: 130, y: 240 }, true, false), { x: 30, y: 40 });
  assert.deepEqual(sample({ x: 110, y: 210 }, { x: 130, y: 240 }, true, false), { x: 20, y: 30 }, 'stationary cursor follows moving window origin');
  assert.deepEqual(sample(bounds, { x: 0, y: 0 }, false, false), { x: -100, y: -200 }, 'one exit sample hides hover');
  for (let x = 1; x < 1000; x++) assert.equal(sample(bounds, { x, y: -100 }, false, false), null);
});
test('cursor sampling leaves input capture alone and refreshes after it closes', () => {
  const sample = createPointerSampler(), bounds = { x: 100, y: 200 }, point = { x: 130, y: 240 };
  assert.deepEqual(sample(bounds, point, true, false), { x: 30, y: 40 });
  assert.equal(sample(bounds, point, true, true), null);
  assert.equal(sample(bounds, { x: -1000, y: 0 }, false, true), null);
  assert.deepEqual(sample(bounds, point, true, false), { x: 30, y: 40 });
  assert.equal(sample(bounds, point, true, true), null);
  assert.deepEqual(sample(bounds, { x: 0, y: 0 }, false, false), { x: -100, y: -200 }, 'release outside must clear a tooltip restored by pointerup');
  assert.equal(sample(bounds, { x: -1, y: 0 }, false, false), null);
});
test('helper uses authenticated duplex pipe and observes host disconnection', async () => {
  const server = new DshPetRpcServer(); const address = await server.start(async input => ({ status: 200, body: input.url }));
  let disconnected = false; const client = connectHost(address.endpoint, address.token, () => { disconnected = true; });
  await client.ready; assert.equal((await client.request('GET', '/dsh-pet-7340/state')).body, '/dsh-pet-7340/state');
  await server.close(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(disconnected, true); client.close();
});
test('media supports full, bounded, suffix and invalid byte ranges', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-media-')), file = path.join(root, 'video.webm');
  try { await writeFile(file, '0123456789');
    for (const [range, status, text] of [[null, 200, '0123456789'], ['bytes=2-4', 206, '234'], ['bytes=-3', 206, '789'], ['bytes=8-', 206, '89'], ['bytes=90-', 416, ''], ['bytes=1-2,4-5', 416, '']] as const) {
      const response = await fileResponse(file, range, 'video/webm'); assert.equal(response.status, status); assert.equal(await response.text(), text);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
