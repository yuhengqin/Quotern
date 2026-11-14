import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('repeated session snapshot updates release obsolete history graphs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-session-memory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Run beside the compiled implementation; the fixture itself is plain JS.
  const fixture = fileURLToPath(new URL('../../test/fixtures/session-memory-probe.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ['--expose-gc', '--max-old-space-size=192', fixture, directory], { timeout: 30000 });
  const { first, last } = JSON.parse(stdout.trim()) as { first: number; last: number };
  assert.ok(last - first < 8 * 1024 * 1024, `obsolete snapshots retained ${Math.round((last - first) / 1048576)} MiB after refresh`);
});
