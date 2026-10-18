import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetAssetStore } from './asset-store.js';

test('uses each pack asset root and never falls back from an exclusive meme directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-assets-'));
  try {
    const store = new DshPetAssetStore(root, path.resolve('out/dsh-pet'));
    await mkdir(path.join(root, 'pet/fish-animation/webm'), { recursive: true });
    await writeFile(path.join(root, 'pet/fish-animation/webm/动作.webm'), 'pet movie');
    assert.equal((await store.resolve('/thumb/fish/%E5%8A%A8%E4%BD%9C.webm'))?.file, path.join(root, 'pet/fish-animation/webm/动作.webm'));
    await mkdir(path.join(root, 'memes'), { recursive: true });
    await writeFile(path.join(root, 'memes/hello.png'), 'main meme');
    await mkdir(path.join(root, 'pet/fish-memes'), { recursive: true });
    assert.equal(await store.resolve('/pic/memes/fish/hello.png'), null);
    assert.equal((await store.resolve('/pic/memes/main/hello.png'))?.file, path.join(root, 'memes/hello.png'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses decoded path traversal, Windows path separators and linked directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-assets-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-external-'));
  try {
    const store = new DshPetAssetStore(root, path.resolve('out/dsh-pet'));
    for (const route of ['/thumb/%2e%2e/secret.webm', '/thumb/main/%2e%2e%5csecret.webm', '/thumb/C%3A/secret.webm', '/pic/%2e%2e/secret.png']) {
      assert.equal(await store.resolve(route), null);
    }
    await mkdir(path.join(root, 'pet'), { recursive: true });
    await mkdir(path.join(outside, 'webm'));
    await writeFile(path.join(outside, 'webm/secret.webm'), 'must not escape');
    await symlink(outside, path.join(root, 'pet/linked-animation'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await store.resolve('/thumb/linked/secret.webm'), null);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
