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

function overviewReport() {
  const input = report({ period: 'overview' });
  input.breakdowns = {
    daily: [
      { ...input.rows[0], label: '2026-10-11', fromDate: '2026-10-11', toDate: '2026-10-11', tokens: 310000000 },
      { ...input.rows[1], label: '2026-10-17', fromDate: '2026-10-17', toDate: '2026-10-17', tokens: 900000000 },
    ],
    models: structuredClone(input.rows),
    projects: [{ ...input.rows[0], label: 'project-with-usage', project: 'project-with-usage', tokens: input.summary.tokens }],
  };
  input.rows = [{ label: '合计', ...input.summary }];
  return input;
}

test('overview renders composition, trend and both distributions with every detail row', async () => {
  const { renderUsageHtml } = await renderer();
  const input = overviewReport();
  const before = structuredClone(input);
  const html = renderUsageHtml(input);
  assert.match(html, /综合用量概览/);
  for (const id of ['composition', 'daily', 'models', 'projects']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /project-with-usage/);
  assert.match(html, /model-shared/);
  assert.match(html, /2026-10-11/);
  assert.match(html, /2026-10-17/);
  assert.equal((html.match(/<tbody>/g) ?? []).length, 3);
  assert.equal((html.match(/<tr><th scope="row">/g) ?? []).length, 6);
  assert.doesNotMatch(html, /\$12\.35/);
  assert.deepEqual(input, before);
});

test('overview rejects missing dimensions, invalid nested values and inconsistent totals', async () => {
  const { renderUsageHtml } = await renderer();
  const input = overviewReport();
  delete input.breakdowns.daily;
  assert.throws(() => renderUsageHtml(input), /breakdowns/);
  const invalid = overviewReport();
  invalid.breakdowns.projects[0].tokens = -1;
  assert.throws(() => renderUsageHtml(invalid), /tokens/);
  const mismatch = overviewReport();
  mismatch.breakdowns.daily[0].tokens++;
  assert.throws(() => renderUsageHtml(mismatch), /total/i);
  const malicious = overviewReport();
  malicious.breakdowns.projects[0].label = '</table><script>alert(1)</script>';
  assert.doesNotMatch(renderUsageHtml(malicious), /<script/);
});

test('empty overview keeps all sections and unknown cache metrics without invented rows', async () => {
  const { renderUsageHtml } = await renderer();
  const input = overviewReport();
  Object.assign(input.summary, { tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  input.breakdowns = { daily: [], models: [], projects: [] };
  const html = renderUsageHtml(input);
  assert.doesNotMatch(html.slice(html.indexOf('<body>')), /NaN|Infinity/);
  assert.match(html, /暂无已采集记录/);
  assert.match(html, /命中率[^<]*未记录/);
  assert.equal((html.match(/<tr><th scope="row">/g) ?? []).length, 0);
});

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
  // Inspect report content, not incidental character sequences in font bytes.
  assert.doesNotMatch(html.slice(html.indexOf('<body>')), /NaN|Infinity/);
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

test('time-series hover values use compact units while retaining exact amounts', async () => {
  const { renderUsageHtml } = await renderer();
  for (const [tokens, formatted, precise] of [
    [3200, '3.2K', '3,200'],
    [493082972, '493.08M', '493,082,972'],
    [1234000000, '1.23B', '1,234,000,000'],
    [1234000000000, '1.23T', '1,234,000,000,000'],
  ]) {
    const input = report({ period: 'daily' });
    input.rows = [{ label: '2026-10-17', fromDate: '2026-10-17', toDate: '2026-10-17', tokens }];
    const html = renderUsageHtml(input);
    assert.ok(html.includes(`<title>2026-10-17：${formatted} Token（精确值 ${precise}）</title>`));
  }
});

test('time-series axis has readable evenly spaced ticks and enough headroom for the largest bar', async () => {
  const { renderUsageHtml } = await renderer();
  for (const [tokens, expectedLabels] of [
    [493082972, ['0', '100M', '200M', '300M', '400M', '500M']],
    [1234000000000, ['0', '250B', '500B', '750B', '1T', '1.25T']],
    [3200, ['0', '1K', '2K', '3K', '4K']],
    [1, ['0', '0.2', '0.4', '0.6', '0.8', '1']],
  ]) {
    const input = report({ period: 'daily' });
    input.rows = [{ label: '2026-10-17', fromDate: '2026-10-17', toDate: '2026-10-17', tokens }];
    const html = renderUsageHtml(input);
    const labels = [...html.matchAll(/<text class="y-label"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
    assert.deepEqual(labels, expectedLabels);
    const gridY = [...html.matchAll(/<line class="y-grid"[^>]*y1="([^"]+)"/g)].map(match => Number(match[1]));
    assert.equal(gridY.length, labels.length);
    const step = gridY[0] - gridY[1];
    for (let index = 1; index < gridY.length; index++) assert.ok(Math.abs(gridY[index - 1] - gridY[index] - step) < 1e-8);
    const bar = html.match(/<rect[^>]*y="([^"]+)"[^>]*height="([^"]+)"/);
    assert.ok(Number(bar[1]) >= gridY.at(-1) - 1e-8);
    assert.ok(Number(bar[1]) + Number(bar[2]) <= gridY[0] + 1e-8);
  }
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
