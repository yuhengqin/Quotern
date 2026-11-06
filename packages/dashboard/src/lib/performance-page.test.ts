import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPerformanceReport, parsePerformanceSearch, sortPerformanceGroups } from './performance-page.ts';
import type { PerformanceReport } from 'quotern-core';
import { parseSessionPageSearch } from './session-page.ts';

test('performance sorting keeps missing metrics last in either direction and preserves zero', () => {
  const rows = [null, 100, 0, 50].map((value, i) => ({ label: String(i), ttftP50Ms: value, ttftP95Ms: value, tokensPerSecond: value, ttftSampleCount: 1, speedSampleCount: 1, sessionCount: 1 }));
  assert.deepEqual(sortPerformanceGroups(rows, 'ttftP50Ms', 'ascending').map(x => x.ttftP50Ms), [0, 50, 100, null]);
  assert.deepEqual(sortPerformanceGroups(rows, 'tokensPerSecond', 'descending').map(x => x.tokensPerSecond), [100, 50, 0, null]);
});

test('an older runtime can reject model comparison without losing the base report', async () => {
  const urls: string[] = [], report = { sampleCount: 3 } as PerformanceReport;
  const result = await loadPerformanceReport('/functions/tud-performance?days=7&model=a&compareModels=%5B%22a%22%5D', async url => {
    urls.push(url);
    if (url.includes('compareModels')) throw new Error('INVALID_PERFORMANCE_QUERY');
    return report;
  });
  assert.equal(result.sampleCount, 3);
  assert.equal(result.comparisonUnsupported, true);
  assert.deepEqual(urls, ['/functions/tud-performance?days=7&model=a&compareModels=%5B%22a%22%5D', '/functions/tud-performance?days=7&model=a']);
  let requests = 0;
  await assert.rejects(loadPerformanceReport('/functions/tud-performance?compareModels=%5B%22a%22%5D', async () => { requests++; throw new Error('NETWORK_FAILED'); }), /NETWORK_FAILED/);
  assert.equal(requests, 1, 'unrelated failures must not silently change the requested report');
});

test('performance return context preserves allowlisted filters and bounded model selection', () => {
  const filters = parsePerformanceSearch({ days: 30, model: 'a/b', sort: 'ttftP95Ms', direction: 'ascending', compare: ['a', 'a', 'b', 'c', 'd', 'e'], redirect: 'https://example.test' });
  assert.deepEqual(filters.compare, ['a', 'b', 'c', 'd']);
  const restored = parseSessionPageSearch(JSON.parse(JSON.stringify({ sessionSource: 'codex', sessionId: 's', performanceReturn: filters })));
  assert.deepEqual(restored.performanceReturn, filters);
  assert.equal(parseSessionPageSearch({ performanceReturn: 'https://example.test' }).performanceReturn, undefined);
  assert.equal('redirect' in filters, false);
});
