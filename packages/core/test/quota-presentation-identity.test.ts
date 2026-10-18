import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctQuotaAllowances } from '../src/quota/shared/quota-presentation.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';

test('quota presentation merges verified successful duplicates without hiding unknown or failed readers', () => {
  const provider = (id: string, accountRef: string, fetchedAt: number, verified = true) => ({
    ...normalizeQuotaSnapshot('codex', 'Codex', { status: 'ready', fetchedAt, windows: [{ id: 'primary', label: '5h', usedPercent: 20, resetsAt: 20000 }] }),
    id, providerId: 'codex', provenance: { source: 'native' as const, observer: 'test', observedAt: fetchedAt, identityVerified: verified, accountRef },
  });
  const first = provider('codex', 'a', 1000), fresh = provider('codex@work', 'a', 1100);
  const second = provider('codex@personal', 'b', 1200), unknown = provider('codex@unknown', 'a', 1200, false);
  const failed = { ...provider('codex@failed', 'a', 1300), status: 'expired' };
  assert.deepEqual(distinctQuotaAllowances([first, fresh, second, unknown, failed]).map(row => row.id), ['codex@work', 'codex@personal', 'codex@unknown', 'codex@failed']);
  const unavailable = { ...fresh, stale: true, message: '暂时无法读取，保留上次观察' };
  assert.deepEqual(distinctQuotaAllowances([first, unavailable]), [first, unavailable]);
});
