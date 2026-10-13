import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { rotateLogIfNeeded, appendJsonLog } from '../src/debug-log.js';
import {
  buildCodexNotifyCmd,
  isLegacyCodexNotifyCmd,
  isOwnCodexNotifyCmd,
} from '../src/hooks/codex.js';
import { buildNotifySh } from '../src/hooks/claude.js';
import { LOG_MAX_BYTES } from '../src/paths.js';

const NOTIFY_PATH = '/Users/test/.ai-usage/bin/notify.sh';

test('buildCodexNotifyCmd uses bash argv (no node)', () => {
  if (process.platform === 'win32') {
    assert.deepEqual(buildCodexNotifyCmd('C:\\\\tud\\\\bin\\\\notify.cmd'), [
      'C:\\\\tud\\\\bin\\\\notify.cmd',
      '--source=codex',
    ]);
  } else {
    assert.deepEqual(buildCodexNotifyCmd(NOTIFY_PATH), [
      '/bin/bash',
      NOTIFY_PATH,
      '--source=codex',
    ]);
  }
  assert.ok(!buildCodexNotifyCmd(NOTIFY_PATH).includes('node'));
});

test('isLegacyCodexNotifyCmd detects old single-string notify', () => {
  const legacy = [`/usr/bin/env node /Users/test/.ai-usage/bin/notify.mjs --source=codex`];
  assert.equal(isLegacyCodexNotifyCmd(legacy, NOTIFY_PATH), true);
  assert.equal(isLegacyCodexNotifyCmd(buildCodexNotifyCmd(NOTIFY_PATH), NOTIFY_PATH), false);
});

test('isOwnCodexNotifyCmd detects tud notify across generations', () => {
  assert.equal(
    isOwnCodexNotifyCmd(['/usr/bin/env', 'node', '/x/bin/notify.mjs', '--source=codex']),
    true,
  );
  assert.equal(isOwnCodexNotifyCmd(['/bin/bash', '/x/bin/notify.sh', '--source=codex']), true);
  assert.equal(isOwnCodexNotifyCmd(['/usr/local/bin/other-notify', '--flag']), false);
});

test('buildNotifySh uses per-source throttle files', () => {
  const script = buildNotifySh('/Users/test/.ai-usage');
  assert.match(script, /notify\.throttle\.\$source/);
  assert.doesNotMatch(script, /notify\.throttle'\);/);
});

test('rotateLogIfNeeded removes previous backup before rotating', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-rotate-'));
  const logPath = join(dir, 'test.log');
  const backupPath = `${logPath}.1`;

  await writeFile(logPath, 'x'.repeat(LOG_MAX_BYTES), 'utf8');
  await writeFile(backupPath, 'old-backup', 'utf8');

  await rotateLogIfNeeded(logPath);

  await access(backupPath);
  const backupText = await readFile(backupPath, 'utf8');
  assert.equal(backupText.length, LOG_MAX_BYTES);
  await assert.rejects(access(logPath));
});

test('appendJsonLog rotates twice without growing backup chain', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-rotate2-'));
  const logPath = join(dir, 'chain.log');
  const backupPath = `${logPath}.1`;

  await appendJsonLog(logPath, { event: 'fill', pad: 'x'.repeat(LOG_MAX_BYTES) });
  await appendJsonLog(logPath, { event: 'second-rotate', pad: 'y'.repeat(LOG_MAX_BYTES) });

  const backupStat = await stat(backupPath);
  assert.ok(backupStat.size >= LOG_MAX_BYTES);
  assert.ok(backupStat.size < LOG_MAX_BYTES * 2);
});
