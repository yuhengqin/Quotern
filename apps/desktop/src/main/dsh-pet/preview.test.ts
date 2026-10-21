import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetAssetStore } from './asset-store.js';
import { createDshPetPreviewHandler } from './preview.js';

const names = ['舞狮头', '点击回应-开心跃动', '原地左转奔跑', '哈欠连天', '用鲸鱼尾巴拍打地面', '堆雪人'];
const url = (name: string) => `quotern-dsh-pet://preview/${encodeURIComponent(name)}.webm`;

test('settings can preview all six bundled animations without starting the pet, including byte ranges', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-preview-'));
  try {
    const runtime = path.join(root, 'runtime');
    await mkdir(path.join(runtime, 'assets/webm'), { recursive: true });
    for (const name of names) await writeFile(path.join(runtime, 'assets/webm', `${name}.webm`), '0123456789');
    const handle = createDshPetPreviewHandler(new DshPetAssetStore(path.join(root, 'user'), runtime));
    for (const name of names) {
      const response = await handle(new Request(url(name)));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'video/webm');
      assert.equal(await response.text(), '0123456789');
    }
    const partial = await handle(new Request(url(names[0]!), { headers: { Range: 'bytes=2-4' } }));
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(await partial.text(), '234');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('settings preview exposes only the six read-only media routes', async () => {
  const handle = createDshPetPreviewHandler(new DshPetAssetStore('missing-user', 'missing-runtime'));
  for (const address of [url('其他动作'), 'quotern-dsh-pet://preview/anim', 'quotern-dsh-pet://other/舞狮头.webm', 'quotern-dsh-pet://preview/%2e%2e%5csecret.webm', 'quotern-dsh-pet://preview/%E0.webm']) {
    assert.equal((await handle(new Request(address))).status, 404);
  }
  assert.equal((await handle(new Request(url(names[0]!), { method: 'POST' }))).status, 405);
  assert.equal((await handle(new Request(url(names[0]!)))).status, 404, 'missing assets are a normal unavailable response');
});
