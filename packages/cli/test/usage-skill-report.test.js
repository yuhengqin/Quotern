import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const rendererUrl = new URL('../skills/quotern-usage/scripts/render-report.mjs', import.meta.url);
const renderer = () => import(rendererUrl);

function report(overrides = {}) {
  const costExplanation = { reportedCostUsd: 1, estimatedCostUsd: 11.3456, unpricedTokens: 0, defaultPricedTokens: 0 };
  return {
    schemaVersion: 1, view: 'compact', period: 'models', timeZone: 'Asia/Shanghai',
    fromDate: '2026-10-11', toDate: '2026-10-17',
    filters: { sources: [], model: null, project: null },
    coverage: {
      limited: false, snapshot: 'persisted', invalidRows: 0,
      collectSince: '2026-04-01T00:00:00Z',
      lastSyncAt: '2026-10-17T18:30:00Z', readAt: '2026-10-17T18:35:00Z',
    },
    summary: {
      tokens: 1210000000, inputTokens: 200000000, outputTokens: 10000000,
      cacheReadTokens: 1000000000, cacheWriteTokens: 0, reasoningTokens: 0,
      costUsd: 12.3456, knownCostUsd: 12.3456, costExplanation,
      localMetrics: { cacheHitRate: null, requestCount: null },
    },
    rows: [
      { label: 'model-shared', source: 'claude', model: 'model-shared', tokens: 10000000, costUsd: 1, knownCostUsd: 1, costExplanation },
      { label: 'model-beta', source: 'codex', model: 'model-beta', tokens: 300000000, costUsd: 2, knownCostUsd: 2, costExplanation },
      { label: 'model-shared', source: 'codex', model: 'model-shared', tokens: 900000000, costUsd: 9.3456, knownCostUsd: 9.3456, costExplanation },
    ],
    ...overrides,
  };
}

test('report preserves all source/model identities and raw totals without mutating input', async () => {
  const { renderUsageHtml } = await renderer();
  const input = report();
  const before = structuredClone(input);
  const html = renderUsageHtml(input, { overview: '主要用量集中在两个模型。' });
  assert.deepEqual(input, before);
  assert.match(html, /1,210,000,000/);
  assert.match(html, /900,000,000/);
  assert.match(html, /10,000,000/);
  assert.match(html, /Codex/);
  assert.match(html, /Claude/);
  assert.match(html, /74\.38%/);
  assert.match(html, /0\.83%/);
  assert.match(html, /主要用量集中在两个模型/);
});

test('token-only report keeps costs out and distinguishes composition from unknown hit rate', async () => {
  const { renderUsageHtml } = await renderer();
  const html = renderUsageHtml(report());
  assert.doesNotMatch(html, /\$12\.35|\$9\.35/);
  assert.match(html, /82\.64%/);
  assert.match(html, /缓存读取/);
  assert.match(html, /命中率[^<]*未记录/);
});

test('incomplete collection and pricing stay visible beside the total', async () => {
  const { renderUsageHtml } = await renderer();
  const input = report();
  input.coverage.limited = true;
  input.coverage.collectSince = '2026-10-15T03:20:00Z';
  input.summary.costUsd = null;
  input.summary.knownCostUsd = 3.2;
  input.summary.costExplanation = { reportedCostUsd: 1, estimatedCostUsd: 2.2, unpricedTokens: 1000000, defaultPricedTokens: 10 };
  const html = renderUsageHtml(input, {}, { costs: true });
  assert.match(html, /覆盖不完整/);
  assert.match(html, /完整费用未知/);
  assert.match(html, /\$3\.20/);
  assert.match(html, /缺少价格/);
  assert.match(html, /默认价格/);
  assert.match(html, /不代表实际支付/);
});

test('zero totals and empty results do not invent percentages or measured zero cache reuse', async () => {
  const { renderUsageHtml } = await renderer();
  const input = report({ rows: [] });
  Object.assign(input.summary, { tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  const html = renderUsageHtml(input);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /暂无已采集记录/);
  assert.match(html, /命中率[^<]*未记录/);
});

test('all supplied text is escaped and report has no active content or remote resources', async () => {
  const { renderUsageHtml } = await renderer();
  const attack = '<img src="https://example.com/x" onerror="alert(1)">';
  const input = report();
  input.rows[0].label = attack;
  const html = renderUsageHtml(input, { title: attack, overview: '</style><script>alert(1)</script>', findings: [{ title: attack, detail: attack }] });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script\b|<img\b|<iframe\b|<link\b/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<th[^>]+scope="col"/);
  assert.match(html, /<details/);
});

test('timestamps use the supplied time zone across local date boundaries', async () => {
  const { renderUsageHtml } = await renderer();
  const html = renderUsageHtml(report());
  assert.match(html, /2026年10月18日 02:30/);
  assert.match(html, /北京时间/);
});

test('small nonzero shares and prices remain nonzero at display precision', async () => {
  const { renderUsageHtml } = await renderer();
  const input = report();
  input.rows[0].tokens = 1;
  input.rows[0].costUsd = 0.000001;
  const html = renderUsageHtml(input, {}, { costs: true });
  assert.match(html, /&lt;0\.01%/);
  assert.match(html, /&lt;\$0\.01/);
});

test('unknown schemas, invalid amounts and malformed annotations fail explicitly', async () => {
  const { renderUsageHtml } = await renderer();
  assert.throws(() => renderUsageHtml(report({ schemaVersion: 2 })), /schemaVersion/);
  const input = report();
  input.rows[0].tokens = -1;
  assert.throws(() => renderUsageHtml(input), /tokens/);
  assert.throws(() => renderUsageHtml(report(), { findings: 'not an array' }), /findings/);
  assert.throws(() => renderUsageHtml(report({ timeZone: undefined })), /timeZone/);
});

test('analysis attribution distinguishes supplied prose from the measured data', async () => {
  const { renderUsageHtml } = await renderer();
  assert.match(renderUsageHtml(report(), { overview: '头部用量集中。' }), /文字解读由 AI 生成/);
  assert.doesNotMatch(renderUsageHtml(report()), /文字解读由 AI 生成/);
});

test('time-series chart follows chronological order while retaining every table row', async () => {
  const { renderUsageHtml } = await renderer();
  const input = report({ period: 'daily' });
  input.rows = [
    { ...input.rows[0], label: '2026-10-17', fromDate: '2026-10-17', toDate: '2026-10-17' },
    { ...input.rows[1], label: '2026-10-11', fromDate: '2026-10-11', toDate: '2026-10-11' },
  ];
  const html = renderUsageHtml(input);
  assert.match(html, /<svg/);
  assert.match(html, /2026-10-11/);
  assert.match(html, /2026-10-17/);
});

test('CLI accepts UTF-8 BOM input, creates portable output and protects existing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-skill-report-'));
  try {
    const input = join(dir, 'usage.json');
    const output = join(dir, 'report.html');
    await writeFile(input, '\uFEFF' + JSON.stringify(report()), 'utf8');
    const result = spawnSync(process.execPath, [fileURLToPath(rendererUrl), '--input', input, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).rows, 3);
    assert.match(await readFile(output, 'utf8'), /<!doctype html>/i);
    const again = spawnSync(process.execPath, [fileURLToPath(rendererUrl), '--input', input, '--output', output], { encoding: 'utf8' });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /exists|存在/i);
    const original = await readFile(input, 'utf8');
    assert.equal(original.charCodeAt(0), 0xFEFF);
  } finally {
    assert.ok(!relative(resolve(tmpdir()), resolve(dir)).startsWith('..'));
    await rm(dir, { recursive: true, force: true });
  }
});

test('force cannot overwrite an input through a hard-link alias', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-skill-alias-'));
  try {
    const input = join(dir, 'usage.json');
    const alias = join(dir, 'alias.html');
    const original = JSON.stringify(report());
    await writeFile(input, original);
    await link(input, alias);
    const result = spawnSync(process.execPath, [fileURLToPath(rendererUrl), '--input', input, '--output', alias, '--force'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(input, 'utf8'), original);
  } finally {
    assert.ok(!relative(resolve(tmpdir()), resolve(dir)).startsWith('..'));
    await rm(dir, { recursive: true, force: true });
  }
});

test('force cannot overwrite analysis through a Windows case alias', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-skill-case-'));
  try {
    const input = join(dir, 'usage.json');
    const analysis = join(dir, 'analysis.json');
    const original = JSON.stringify({ overview: '保留分析输入。' });
    await writeFile(input, JSON.stringify(report()));
    await writeFile(analysis, original);
    const result = spawnSync(process.execPath, [fileURLToPath(rendererUrl), '--input', input, '--analysis', analysis, '--output', join(dir, 'ANALYSIS.JSON'), '--force'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(analysis, 'utf8'), original);
  } finally {
    assert.ok(!relative(resolve(tmpdir()), resolve(dir)).startsWith('..'));
    await rm(dir, { recursive: true, force: true });
  }
});
