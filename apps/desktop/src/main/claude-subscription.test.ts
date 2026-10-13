import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyClaudeAuthStatus,
  hasCustomClaudeConfiguration,
} from './claude-subscription';

test('accepts only a logged-in first-party OAuth account', () => {
  assert.equal(classifyClaudeAuthStatus({
    loggedIn: true,
    authMethod: 'oauth_token',
    apiProvider: 'firstParty',
  }), 'official');
  assert.equal(classifyClaudeAuthStatus({ loggedIn: false }), 'not-signed-in');
  assert.equal(classifyClaudeAuthStatus({
    loggedIn: true,
    authMethod: 'api_key',
    apiProvider: 'firstParty',
  }), 'custom-provider');
  assert.equal(classifyClaudeAuthStatus({
    loggedIn: true,
    authMethod: 'oauth_token',
    apiProvider: 'bedrock',
  }), 'custom-provider');
  assert.equal(classifyClaudeAuthStatus({}), null);
});

test('detects custom API, base URL, helper, and cloud-provider settings', () => {
  assert.equal(hasCustomClaudeConfiguration({ ANTHROPIC_API_KEY: 'sk-test' }), true);
  assert.equal(hasCustomClaudeConfiguration({ ANTHROPIC_BASE_URL: 'https://example.test' }), true);
  assert.equal(hasCustomClaudeConfiguration({}, [{ apiKeyHelper: '/bin/helper' }]), true);
  assert.equal(hasCustomClaudeConfiguration({}, [{ env: { CLAUDE_CODE_USE_VERTEX: '1' } }]), true);
  assert.equal(hasCustomClaudeConfiguration({ CLAUDE_CODE_USE_BEDROCK: 'false' }), false);
  assert.equal(hasCustomClaudeConfiguration({}, [{ env: {} }]), false);
});


import { CLAUDE_USAGE_ARGS, createClaudeSubscriptionReader, runClaudeCommand, resolveClaudeCommand } from './claude-subscription';
import { parseClaudeResetTime, parseClaudeUsageResult } from './claude-usage-parser';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const output = (text: string, is_error = false) => JSON.stringify({ type: 'result', result: text, is_error });
const usage = 'Current session: 13% used · resets Oct 8 at 3:30pm (Asia/Shanghai)\nCurrent week (all models): 4% used · resets Oct 9, 2:59pm (UTC)\nCurrent week (Opus): 99% used';
const now = new Date('2026-10-08T06:00:00Z');
test('reads Claude JSON object/verbose array and only aggregate windows', () => {
  for (const value of [output(usage), JSON.stringify([{ type: 'system' }, JSON.parse(output(usage))])]) {
    const parsed = parseClaudeUsageResult(value, now);
    assert.equal(parsed.fiveHour?.usedPercent, 13);
    assert.equal(parsed.sevenDay?.usedPercent, 4);
    assert.equal(parsed.fiveHour?.resetsAt, Date.parse('2026-10-08T07:30:00Z') / 1000);
    assert.equal(parsed.sevenDay?.resetsAt, Date.parse('2026-10-09T14:59:00Z') / 1000);
  }
  assert.equal(parseClaudeUsageResult(output('Current week (Opus): 99% used')).sevenDay, null);
  assert.equal(parseClaudeUsageResult(output('\u001b[31mCurrent session: 0% used\u001b[0m')).fiveHour?.usedPercent, 0);
  assert.equal(parseClaudeUsageResult(output('Current session: 20% used · resets unknown')).fiveHour?.resetsAt, null);
  assert.equal(parseClaudeUsageResult(output(usage + '\n401 unauthorized')).fiveHour, null);
  assert.equal(parseClaudeUsageResult(output('You are currently using your subscription to power your Claude Code usage')).fiveHour, null);
});
test('reset parsing handles cross-year, time-only, DST folds and invalid dates', () => {
  assert.equal(parseClaudeResetTime('Jan 1 at 3pm (UTC)', new Date('2026-12-31T15:00:00Z'), 168), Date.parse('2027-01-01T15:00:00Z')/1000);
  assert.equal(parseClaudeResetTime('3pm (Asia/Shanghai)', now, 5), Date.parse('2026-10-08T07:00:00Z')/1000);
  assert.equal(parseClaudeResetTime('Nov 1 at 1:30am (America/New_York)', new Date('2026-11-01T05:45:00Z'), 5), Date.parse('2026-11-01T06:30:00Z')/1000);
  assert.equal(parseClaudeResetTime('Feb 31 at 3pm (UTC)', now, 168), null);
  assert.equal(parseClaudeResetTime('25pm (UTC)', now, 5), null);
});
test('Claude auth JSON is parsed even on exit 1; concurrency/cache and identities isolate results', async () => {
  let email = 'one', count = 0, clock = now.getTime(), usageCode = 0;
  const read = createClaudeSubscriptionReader({ now: () => clock, custom: async () => false,
    auth: async () => ({ code: 1, stdout: JSON.stringify({ loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty', email, subscriptionType: 'pro' }) }),
    usage: async () => { count++; return { code: usageCode, stdout: output(usage) }; },
  });
  const snapshots = await Promise.all([read(), read()]);
  assert.equal(count, 1); assert.equal(snapshots[0].status, 'ready');
  await read(); assert.equal(count, 1);
  clock += 61000; usageCode = 1; assert.equal((await read()).stale, true);
  email = 'two'; assert.equal((await read()).fiveHour, null);
  usageCode = 0; assert.equal((await read({ forceRefresh: true })).status, 'ready');
});
test('sign-out and custom configurations do not run /usage', async () => {
  for (const custom of [true, false]) {
    const read = createClaudeSubscriptionReader({ custom: async () => custom, auth: async () => ({ code: 1, stdout: '{"loggedIn":false}' }), usage: async () => { assert.fail('must not run'); } });
    assert.equal((await read()).hasAccount, false);
  }
});
test('CLI args disable tools, settings, MCP and persistence', () => {
  assert.deepEqual(CLAUDE_USAGE_ARGS, ['-p','/usage','--output-format','json','--tools','','--strict-mcp-config','--setting-sources','','--no-session-persistence']);
});
test('pnpm bin discovery does not depend on shell PATH', { skip: process.platform === 'win32' }, () => {
  const home = mkdtempSync(path.join(tmpdir(), 'quotern-claude-test-'));
  try {
    const command = path.join(home, 'Library', 'pnpm', 'bin', 'claude');
    mkdirSync(path.dirname(command), { recursive: true }); writeFileSync(command, '');
    assert.equal(resolveClaudeCommand(home, {}), command);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('command runner drains output on nonzero exits, bounds output, kills timed-out processes', async () => {
  const result = await runClaudeCommand(process.execPath, ['-e','process.stdout.write("{\\"loggedIn\\":false}");process.exitCode=1'], tmpdir(), process.env);
  assert.equal(result.code, 1); assert.deepEqual(JSON.parse(result.stdout), { loggedIn: false });
  await assert.rejects(runClaudeCommand(process.execPath, ['-e','setInterval(()=>{},1000)'], tmpdir(), process.env, 50), /timeout/);
  await assert.rejects(runClaudeCommand(process.execPath, ['-e','process.stdout.write("a".repeat(300000))'], tmpdir(), process.env), /output-limit/);
});

test('accepts Claude.ai subscription sign-in reported by native CLI', () => {
  assert.equal(classifyClaudeAuthStatus({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }), 'official');
});
test('Claude account refusal removes cached allowance and sign-out resets it', async () => {
  let signedIn = true, text = usage;
  const read = createClaudeSubscriptionReader({ now: () => now.getTime(), custom: async () => false,
    auth: async () => ({ code: signedIn ? 0 : 1, stdout: JSON.stringify({ loggedIn: signedIn, authMethod: 'oauth_token', apiProvider: 'firstParty', email: 'one' }) }),
    usage: async () => ({ code: 0, stdout: output(text) }),
  });
  await read();
  text = '401 Unauthorized';
  const refused = await read({ forceRefresh: true });
  assert.equal(refused.status, 'expired'); assert.equal(refused.fiveHour, null); assert.equal(refused.hasAccount, true);
  text = 'temporarily unavailable';
  assert.equal((await read({ forceRefresh: true })).fiveHour, null);
  signedIn = false; assert.equal((await read()).hasAccount, false);
  signedIn = true; assert.equal((await read()).fiveHour, null);
});
