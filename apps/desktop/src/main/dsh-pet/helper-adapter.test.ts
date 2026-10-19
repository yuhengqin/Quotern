import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DshPetRpcServer } from './rpc.js';
import { connectHost, fileResponse } from './helper-adapter.js';
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
