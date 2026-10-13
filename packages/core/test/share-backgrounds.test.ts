import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { createHttpServer, listenServer } from '../src/server/http-server.js';

const route = '/functions/tud-share-backgrounds';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const otherImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
// A real 2x3 JPEG, generated from RGB pixels rather than a header-only mock.
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiqKKK+lPnz//Z';
const webp = 'data:image/webp;base64,UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+899n/maGeSjy4f+QXq3zbGgAAA==';

function appAt(dir: string) {
  return createLocalApiApp({ dataDir: dir, getConfig: () => { throw new Error('backgrounds must not need config'); }, bucketStore: new BucketStore() });
}
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-shared-backgrounds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, app: appAt(dir), index: join(dir, 'share-backgrounds', 'index.json') };
}
async function post(app: ReturnType<typeof appAt>, body: unknown, status = 200) {
  const res = await app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, status, await res.clone().text());
  return (await res.json()).data;
}
async function list(app: ReturnType<typeof appAt>) {
  const res = await app.request(route);
  assert.equal(res.status, 200);
  return (await res.json()).data;
}
const legacy = (id: string, value = image) => ({ id, name: id, image: value, createdAt: 100, lastUsedAt: 200 });

test('HTTP and Desktop-style local-api instances share binary assets and CRUD', async (t) => {
  const f = await fixture(t);
  const second = appAt(f.dir);
  const saved = await post(f.app, { operation: 'add', input: { name: 'browser A', image } });
  assert.equal(saved.length, 1);
  assert.deepEqual(await list(second), saved);
  assert.equal(saved[0].image, image);
  const index = await readFile(f.index, 'utf8');
  assert.ok(!index.includes('base64'), 'image bytes do not belong in metadata');
  assert.ok((await readdir(join(f.dir, 'share-backgrounds'))).some((name) => name.endsWith('.png')));
  const touched = await post(second, { operation: 'touch', id: saved[0].id });
  assert.ok(touched[0].lastUsedAt >= saved[0].lastUsedAt);
  await post(second, { operation: 'remove', id: saved[0].id });
  assert.deepEqual(await list(f.app), []);
  assert.deepEqual((await readdir(join(f.dir, 'share-backgrounds'))).filter((name) => name.endsWith('.png')), []);
});

test('capacity, explicit replacement, stale IDs and invalid input preserve committed state', async (t) => {
  const f = await fixture(t);
  for (const name of ['one', 'two', 'three']) await post(f.app, { operation: 'add', input: { name, image } });
  const saved = await list(f.app);
  const before = await readFile(f.index, 'utf8');
  await post(f.app, { operation: 'add', input: { name: 'four', image } }, 409);
  await post(f.app, { operation: 'add', input: { name: 'bad', image }, replaceId: 'missing' }, 409);
  for (const input of [{ name: 'bad', image: 'data:image/png;base64,dGVzdA==' }, { name: 1, image }, { name: 'svg', image: 'data:image/svg+xml;base64,PHN2Zy8+' }]) {
    await post(f.app, { operation: 'add', input }, 400);
  }
  assert.equal(await readFile(f.index, 'utf8'), before);
  const changed = await post(f.app, { operation: 'add', input: { name: 'four', image: otherImage }, replaceId: saved[1].id });
  assert.equal(changed.length, 3);
  assert.ok(!changed.some((item: { id: string }) => item.id === saved[1].id));
  assert.equal(changed.filter((item: { name: string }) => item.name === 'four').length, 1);
  assert.equal((await readdir(join(f.dir, 'share-backgrounds'))).filter((name) => name.endsWith('.png')).length, 2, 'still-referenced image is retained');
});

test('migration deduplicates content, preserves timestamps and never resurrects deleted imports', async (t) => {
  const f = await fixture(t);
  const imported = await post(f.app, { operation: 'import', items: [legacy('old-A'), legacy('old-B')] });
  assert.equal(imported.items.length, 1);
  assert.deepEqual(imported.acceptedIds.sort(), ['old-A', 'old-B']);
  assert.deepEqual(imported.pendingIds, []);
  assert.equal(imported.items[0].createdAt, 100);
  assert.equal(imported.items[0].lastUsedAt, 200);
  await post(f.app, { operation: 'remove', id: imported.items[0].id });
  const retry = await post(appAt(f.dir), { operation: 'import', items: [legacy('old-A'), legacy('old-B')] });
  assert.deepEqual(retry.items, []);
  assert.deepEqual(retry.acceptedIds.sort(), ['old-A', 'old-B']);
});

test('full gallery leaves migration pending and retry imports after space is freed', async (t) => {
  const f = await fixture(t);
  for (const name of ['one', 'two', 'three']) await post(f.app, { operation: 'add', input: { name, image } });
  const before = await list(f.app);
  const result = await post(f.app, { operation: 'import', items: [legacy('pending', otherImage)] });
  assert.deepEqual(result.items, before);
  assert.deepEqual(result.pendingIds, ['pending']);
  assert.deepEqual(result.acceptedIds, []);
  await post(f.app, { operation: 'remove', id: before[0].id });
  const retry = await post(f.app, { operation: 'import', items: [legacy('pending', otherImage)] });
  assert.equal(retry.items.length, 3);
  assert.deepEqual(retry.pendingIds, []);
});

test('broken metadata and failed commits cannot overwrite the old gallery', async (t) => {
  const f = await fixture(t);
  await post(f.app, { operation: 'add', input: { name: 'saved', image } });
  await writeFile(f.index, 'broken JSON');
  await post(f.app, { operation: 'add', input: { name: 'new', image } }, 500);
  assert.equal(await readFile(f.index, 'utf8'), 'broken JSON');
  await rm(f.index);
  await mkdir(f.index);
  await post(f.app, { operation: 'add', input: { name: 'new', image } }, 500);
  assert.equal((await readdir(f.index)).length, 0);
});

test('routes reject malformed requests and declared oversized bodies with JSON envelopes', async (t) => {
  const f = await fixture(t);
  for (const body of [null, { operation: 'unknown' }, { operation: 'remove', id: '../index.json' }, { operation: 'import', items: [legacy('bad'), { ...legacy('bad2'), createdAt: Infinity }] }]) {
    const res = await f.app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).success, false);
  }
  const res = await f.app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '10000000' }, body: '{}' });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).success, false);
  assert.deepEqual(await list(f.app), []);
});

test('independent processes serialize writes and enforce the shared three-image limit', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const workers = Array.from({ length: 4 }, (_, i) => new Promise<number>((resolve, reject) => {
    const child = fork(new URL('./fixtures/share-background-writer.js', import.meta.url), [f.dir, String(i)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    let status = 0;
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('message', (value) => { status = Number(value); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(status) : reject(new Error(stderr)));
    t.after(() => { if (child.exitCode === null) child.kill(); });
  }));
  const statuses = await Promise.all(workers);
  assert.deepEqual(statuses.sort(), [200, 200, 200, 409]);
  assert.equal((await list(f.app)).length, 3);
});

test('HTTP rejects an oversized upload before waiting for its body', async (t) => {
  const f = await fixture(t);
  const server = createHttpServer({ honoApp: f.app, staticDir: f.dir });
  const { port } = await listenServer(server, '127.0.0.1', 0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '999999999' } }, (res) => { res.resume(); resolve(res.statusCode!); });
    const timeout = setTimeout(() => reject(new Error('server waited for oversized upload body')), 1000);
    req.once('response', () => clearTimeout(timeout));
    req.on('error', reject);
    req.flushHeaders();
    t.after(() => { clearTimeout(timeout); req.destroy(); });
  });
  assert.equal(status, 413);
});

test('unrelated web origins cannot read or mutate the local image library', async (t) => {
  const f = await fixture(t);
  for (const method of ['GET', 'POST']) {
    const res = await f.app.request(route, { method, headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ operation: 'add', input: { name: 'bad origin', image } }) } : {}) });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).success, false);
  }
  const local = await f.app.request(route, { headers: { Origin: 'http://127.0.0.1:5194' } });
  assert.equal(local.status, 200);
  assert.deepEqual(await list(f.app), []);
});

test('real cropped JPEGs can be saved and migrated through the shared API', async (t) => {
  const f = await fixture(t);
  const saved = await post(f.app, { operation: 'add', input: { name: 'crop.jpeg', image: jpeg } });
  assert.equal(saved[0].image, jpeg);
  const imported = await post(f.app, { operation: 'import', items: [legacy('old-jpeg', jpeg)] });
  assert.equal(imported.items.length, 1);
  assert.deepEqual(imported.acceptedIds, ['old-jpeg']);
  assert.deepEqual(await list(appAt(f.dir)), saved);
});

test('a header-only truncated image cannot replace or damage an existing background', async (t) => {
  const f = await fixture(t);
  const saved = await post(f.app, { operation: 'add', input: { name: 'valid', image: jpeg } });
  const before = await readFile(f.index, 'utf8');
  const truncated = `data:image/png;base64,${Buffer.from(image.split(',')[1], 'base64').subarray(0, 24).toString('base64')}`;
  await post(f.app, { operation: 'add', input: { name: 'broken', image: truncated }, replaceId: saved[0].id }, 400);
  assert.equal(await readFile(f.index, 'utf8'), before);
  assert.deepEqual(await list(f.app), saved);
});

test('real WebP files are accepted and survive reading from another instance', async (t) => {
  const f = await fixture(t);
  const saved = await post(f.app, { operation: 'add', input: { name: 'valid.webp', image: webp } });
  assert.deepEqual(await list(appAt(f.dir)), saved);
});
