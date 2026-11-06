import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchArgs } from '../dist/launch-command.js';

test('account launch keeps provider, profile and literal forwarded arguments separate', () => {
  const value = parseLaunchArgs(['claude', '--profile', 'work', '--runtime', 'desktop', '--', '--model', 'sonnet', 'literal $env:PATH']);
  assert.equal(value.provider, 'claude'); assert.equal(value.profileId, 'work'); assert.equal(value.runtime, 'desktop');
  assert.deepEqual(value.cliArgs, ['--model', 'sonnet', 'literal $env:PATH']);
  assert.equal(parseLaunchArgs(['--help']), null);
  for (const args of [['other'], ['claude', '--profile', 'x;bad'], ['codex', '--runtime', 'remote'], ['claude', '--cwd'], ['claude', '--profile', 'a', '--profile', 'b']]) assert.throws(() => parseLaunchArgs(args));
});
