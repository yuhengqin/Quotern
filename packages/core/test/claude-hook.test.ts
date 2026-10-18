import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import test from 'node:test';

import { buildHookCommand, upsertClaudeHook } from '../src/hooks/claude.js';

const OTTY_STOP_HOOK = 'otty-agent-hook --event=stop';

test('upsertClaudeHook keeps Otty Stop hooks next to the quotern notify command', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-claude-hook-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const claudeDir = join(tempHome, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, 'settings.json'),
      `${JSON.stringify(
        {
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: OTTY_STOP_HOOK }] }],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const notifyPath = join(tempHome, '.quotern', 'bin', 'notify.sh');
    const result = await upsertClaudeHook(notifyPath);
    assert.equal(result.configured, true);
    assert.equal(result.changed, true);

    const settings = JSON.parse(await readFile(join(claudeDir, 'settings.json'), 'utf8')) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string }> }>>;
    };
    const stopCommands = (settings.hooks?.Stop ?? []).flatMap((entry) =>
      (entry.hooks ?? []).map((h) => h.command),
    );
    assert.ok(stopCommands.includes(OTTY_STOP_HOOK), `Otty hook missing: ${JSON.stringify(stopCommands)}`);
    assert.ok(
      stopCommands.includes(buildHookCommand(notifyPath, 'claude')),
      `quotern hook missing: ${JSON.stringify(stopCommands)}`,
    );
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    rmSync(tempHome, { recursive: true, force: true });
  }
});
