import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { markQuotaIdentity, quotaEvidence, quotaIdentity } from 'quotern-core/quota/readers/quota-identity';
import { createCodexOfficialReader } from './codex-official';

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    killed: false,
    kill() { child.killed = true; child.emit('close', null); return true; },
  });
  const sent: unknown[] = [];
  let pending = '';
  child.stdin.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    for (;;) {
      const at = pending.indexOf('\n');
      if (at < 0) break;
      sent.push(JSON.parse(pending.slice(0, at)));
      pending = pending.slice(at + 1);
    }
  });
  return { child, sent, reply(value: unknown) { child.stdout.write(`${JSON.stringify(value)}\n`); } };
}

test('performs only the fixed handshake and maps multi-bucket usage', async () => {
  const fixture = fakeProcess();
  const read = createCodexOfficialReader({ find: async () => 'synthetic-codex', spawn: () => fixture.child, timeoutMs: 1000 });
  const resultPromise = read();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.sent, [{ id: 1, method: 'initialize', params: { clientInfo: { name: 'quotern', version: '1.0.0' } } }]);
  fixture.reply({ method: 'ignored/notification', params: {} });
  fixture.reply({ id: 1, result: {} });
  assert.deepEqual(fixture.sent.slice(1), [{ method: 'initialized', params: {} }, { id: 2, method: 'account/rateLimits/read' }]);
  fixture.reply({ id: 2, result: {
    accountId: 'synthetic-codex-workspace',
    rateLimitsByLimitId: {
      codex: { limitId: 'codex', planType: 'plus', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1900100000 } },
      code_review: { limitName: 'Code review', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1900000100 } },
    },
    rateLimitResetCredits: { availableCount: 1, credits: [{ status: 'available', expiresAt: 1900200000 }] },
  } });
  const result = await resultPromise;
  assert.equal(fixture.child.killed, true);
  assert.equal(result.status, 'ready');
  assert.equal(quotaIdentity(result), quotaIdentity(markQuotaIdentity({}, 'synthetic-codex-workspace')));
  assert.equal(quotaEvidence(result)?.identityVerified, true);
  assert.match(quotaEvidence(result)?.accountRef ?? '', /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-codex-workspace/);
  assert.equal(result.planLabel, 'Plus');
  assert.equal(result.resetCredits, 1);
  assert.deepEqual(result.resetCreditExpirations, [1900200000]);
  assert.deepEqual(result.windows, [
    { id: 'account:18000', label: '5h', durationSeconds: 18000, usedPercent: 25, resetsAt: 1900000000 },
    { id: 'account:604800', label: '7d', durationSeconds: 604800, usedPercent: 40, resetsAt: 1900100000 },
    { id: 'feature:code_review:18000', label: '5h', groupLabel: 'Code review', durationSeconds: 18000, usedPercent: 10, resetsAt: 1900000100 },
  ]);
});

test('reports an unavailable account and stops the process on RPC failure', async () => {
  const fixture = fakeProcess();
  const read = createCodexOfficialReader({ find: async () => 'synthetic-codex', spawn: () => fixture.child, timeoutMs: 1000 });
  const pending = read();
  await new Promise(resolve => setImmediate(resolve));
  fixture.reply({ id: 1, result: {} });
  fixture.reply({ id: 2, error: { code: -32000, message: 'Not authenticated' } });
  assert.equal((await pending).status, 'not-signed-in');
  assert.equal(fixture.child.killed, true);
});

test('cleans up a stalled process and excessive output', async () => {
  for (const overflow of [false, true]) {
    const fixture = fakeProcess();
    const read = createCodexOfficialReader({ find: async () => 'synthetic-codex', spawn: () => fixture.child, timeoutMs: 20 });
    const pending = read();
    await new Promise(resolve => setImmediate(resolve));
    if (overflow) fixture.child.stdout.write('x'.repeat(1024 * 1024 + 1));
    assert.equal((await pending).status, 'unavailable');
    assert.equal(fixture.child.killed, true);
  }
});

test('reads the legacy single bucket across UTF-8 chunk boundaries', async () => {
  const fixture = fakeProcess();
  const read = createCodexOfficialReader({ find: async () => 'synthetic-codex', spawn: () => fixture.child, timeoutMs: 1000 });
  const pending = read();
  await new Promise(resolve => setImmediate(resolve));
  fixture.reply({ id: 1, result: {} });
  const payload = Buffer.from(`${JSON.stringify({ id: 2, result: { rateLimits: { planType: 'team', limitName: '额度', primary: { usedPercent: 5, windowDurationMins: 300 } } } })}\n`);
  const split = payload.indexOf(Buffer.from('额度')) + 1;
  fixture.child.stdout.write(payload.subarray(0, split));
  fixture.child.stdout.write(payload.subarray(split));
  const result = await pending;
  assert.equal(result.status, 'ready');
  assert.equal(result.windows[0].id, 'account:18000');
  assert.equal(result.planType, 'team');
  assert.equal(quotaIdentity(result), null, 'usage without an account identifier must not be attributed');
  assert.equal(result.resetCredits, null);
});

test('reports a missing CLI without starting a process', async () => {
  const read = createCodexOfficialReader({ find: async () => null, spawn: () => { throw new Error('must not start'); }, timeoutMs: 1000 });
  assert.equal((await read()).status, 'not-installed');
});
