import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const entry = fileURLToPath(new URL(
  `${process.env.QUOTERN_CLI_TEST_DIST ?? '../dist'}/index.js`,
  import.meta.url,
));

test('start explains an occupied saved port without debug mode or taking over its listener', async (t) => {
  const listener = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end('{"exact":{}}');
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  const origin = `http://127.0.0.1:${port}`;

  try {
    for (const [locale, explanation] of [
      ['zh-CN', /已被占用/],
      ['en', /already in use/i],
      ['ja', /使用中/],
      ['ko', /사용 중/],
    ]) {
      await t.test(locale, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'quotern-cli-start-'));
        const dataDir = join(directory, 'data');
        try {
          await mkdir(dataDir);
          await writeFile(join(dataDir, 'config.json'), JSON.stringify({
            deviceId: '00000000-0000-4000-8000-000000000001',
            serverHost: '127.0.0.1',
            serverPort: port,
            pricing: { url: `${origin}/prices` },
          }));
          const error = await run(process.execPath, [entry, 'start', '--lang', locale], {
            env: {
              ...process.env,
              QUOTERN_DEBUG: '0',
              QUOTERN_DEV_ISOLATED: '1',
              QUOTERN_DATA_DIR: dataDir,
              QUOTERN_CONFIG_HOME: join(directory, 'config-home'),
              NO_PROXY: '127.0.0.1,localhost',
              no_proxy: '127.0.0.1,localhost',
            },
            timeout: 15_000,
          }).then(() => assert.fail('start must fail for an occupied port'), (error) => error);

          assert.equal(error.code, 1);
          assert.match(error.stderr, /EADDRINUSE/);
          assert.ok(error.stderr.includes(`127.0.0.1:${port}`), error.stderr);
          assert.match(error.stderr, explanation);
          assert.match(error.stderr, /quotern start --port/);
          assert.match(error.stderr, /serverPort/);
          assert.doesNotMatch(error.stderr, /QUOTERN_DEBUG/);
          assert.doesNotMatch(error.stdout, /✓/);
          await assert.rejects(readFile(join(dataDir, 'tud.pid')), { code: 'ENOENT' });
          const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
          assert.equal(config.serverPort, port);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }

    const status = await new Promise((resolve, reject) => {
      get(`${origin}/health`, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 200);
  } finally {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  }
});
