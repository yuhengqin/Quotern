import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpstreamContracts, renderContractReport } from './check-upstream-contracts.mjs';

const manifest = version => ({ version: 1, upstreams: [{ id: 'codex', package: '@openai/codex', repository: 'https://github.com/openai/codex', verifiedVersion: version, contracts: ['rate_limit.primary_window.used_percent'] }] });
test('unchanged versions do not imply a new compatibility audit', async () => {
  let url;
  const report = await checkUpstreamContracts(manifest('1.0.0'), { fetch: async input => { url = input; return new Response('{"version":"1.0.0"}'); } });
  assert.equal(new URL(url).hostname, 'registry.npmjs.org');
  assert.equal(report.status, 'unchanged');
});
test('a changed version and missing baseline request review, not a claim of breakage', async () => {
  for (const version of [null, '1.0.0']) {
    const report = await checkUpstreamContracts(manifest(version), { fetch: async () => new Response('{"version":"1.1.0"}') });
    assert.equal(report.status, 'review-required');
    assert.match(renderContractReport(report), /复核/);
  }
});
test('network errors, malformed metadata and oversized responses fail the check', async () => {
  for (const read of [async () => { throw new Error('network'); }, async () => new Response('{}'), async () => new Response('bad json'), async () => new Response('x'.repeat(600000)), async () => new Response('{}', { status: 503 })]) {
    const report = await checkUpstreamContracts(manifest(null), { fetch: read });
    assert.equal(report.status, 'check-failed');
  }
});
test('the issue body and fingerprint stay stable across identical runs', async () => {
  const run = () => checkUpstreamContracts(manifest(null), { fetch: async () => new Response('{"version":"1.1.0"}') });
  const a = await run(), b = await run();
  assert.equal(a.fingerprint, b.fingerprint); assert.equal(renderContractReport(a), renderContractReport(b));
});
test('manifest input cannot change the registry destination', async () => {
  let calls = 0;
  const invalid = manifest(null); invalid.upstreams[0].package = 'https://evil.example/pkg';
  const report = await checkUpstreamContracts(invalid, { fetch: async () => { calls++; return new Response('{}'); } });
  assert.equal(report.status, 'check-failed'); assert.equal(calls, 0);
});

test('public semantic probes ignore script text and distinguish missing wording from fetch failure', async () => {
  const input = manifest('1.0.0');
  input.upstreams[0].documents = [{ url: 'https://learn.chatgpt.com/docs/pricing', requiredText: ['weekly limits may also apply'] }];
  const run = html => checkUpstreamContracts(input, { fetch: async url => new URL(url).hostname === 'registry.npmjs.org' ? new Response('{"version":"1.0.0"}') : new Response(html) });
  assert.equal((await run('<p>Weekly limits may <strong>also apply</strong>.</p>')).status, 'unchanged');
  const changed = await run('<script>weekly limits may also apply</script><p>New quota policy</p>');
  assert.equal(changed.status, 'review-required');
  assert.deepEqual(changed.results.find(row => row.kind === 'document').missingText, ['weekly limits may also apply']);
  input.upstreams[0].documents[0].url = 'https://evil.example/pricing';
  let calls = 0;
  const invalid = await checkUpstreamContracts(input, { fetch: async () => { calls++; return new Response('{}'); } });
  assert.equal(invalid.status, 'check-failed'); assert.equal(calls, 0);
});
