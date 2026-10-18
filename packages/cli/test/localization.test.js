import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const outputDir = process.env.QUOTERN_CLI_TEST_DIST ?? '../dist';
const { parseArgs, printHelp, resolveSyncSource } = await import(`${outputDir}/args.js`);
const { parseUsageArgs } = await import(`${outputDir}/usage-args.js`);
const { formatUsageReport } = await import(`${outputDir}/usage-output.js`);
const { printDoctorReport } = await import(`${outputDir}/doctor.js`);
const run = promisify(execFile);

function report() {
  const costExplanation = {
    reportedCostUsd: 1.5, estimatedCostUsd: 0.25,
    unpricedTokens: 12, defaultPricedTokens: 4,
    tokenQualityTokens: { recorded: 100, estimated: 20, ledger: 0, mixed: 0, unknown: 12 },
  };
  return {
    schemaVersion: 1,
    period: 'daily', timeZone: 'Asia/Shanghai',
    fromDate: '2026-10-01', toDate: '2026-10-02',
    filters: { sources: [], model: null, project: null },
    rows: [{ label: 'Model', source: 'codex', model: 'gpt-test', project: 'Quotern',
      tokens: 132, costUsd: null, knownCostUsd: 1.5, costExplanation,
      localMetrics: { requestCount: 2, cacheHitRate: null } }],
    summary: { costExplanation },
    coverage: {
      collectSince: '2026-10-01T00:00:00.000Z',
      lastSyncAt: null, readAt: '2026-10-02T00:00:00.000Z',
      limited: true, snapshot: 'persisted',
    },
  };
}

test('global and usage commands accept an explicit canonical language', () => {
  assert.equal(parseArgs(['node', 'quotern', 'status', '--lang', 'en']).lang, 'en');
  assert.equal(parseArgs(['node', 'quotern', '--lang=ko', '--help']).lang, 'ko');
  const usage = parseUsageArgs(['daily', '--lang=ja', '--json']);
  assert.equal(usage.lang, 'ja');
  assert.deepEqual(usage.query, { period: 'daily' });
  assert.equal(usage.format, 'json');
  assert.throws(() => parseArgs(['node', 'quotern', 'status', '--lang', 'fr']), /--lang.*zh-CN.*en.*ja.*ko/);
});

test('help text follows --lang and includes its option', () => {
  const lines = [];
  const original = console.log;
  try {
    console.log = (value) => lines.push(String(value));
    printHelp('en');
  } finally {
    console.log = original;
  }
  const help = lines.join('\n');
  assert.match(help, /Usage: quotern/);
  assert.match(help, /--lang <zh-CN\|en\|ja\|ko>/);
  assert.match(help, /Show current CLI/);
  assert.doesNotMatch(help, /查看|显示帮助|数据源/);
});

test('argument errors use the explicitly selected language', () => {
  assert.throws(() => parseUsageArgs(['--days', '0', '--lang', 'en']), /--days.*integer/i);
  assert.throws(() => resolveSyncSource('missing', 'ja'), /データソース/);
  assert.throws(() => parseArgs(['node', 'quotern', 'status', '--unknown', '--lang', 'en']), /Unknown option: --unknown/);
  assert.throws(() => parseArgs(['node', 'quotern', 'sync', '--source', '--lang', 'en']), /--source.*value/i);
  assert.throws(() => parseArgs(['node', 'quotern', 'sync', '--source=', '--lang', 'en']), /--source.*value/i);
});

test('human-readable usage text translates labels and formats values with Intl', () => {
  const fixture = report();
  const english = formatUsageReport(fixture, 'text', { locale: 'en' });
  const japanese = formatUsageReport(fixture, 'text', { locale: 'ja' });
  const korean = formatUsageReport(fixture, 'text', { locale: 'ko' });
  assert.match(english, /Reported cost\t\$1\.500000/);
  assert.match(english, /Last sync\tUnknown/);
  assert.match(english, /132\tUnknown \(known \$1\.500000\)/);
  assert.match(japanese, /最終同期/);
  assert.match(korean, /마지막 동기화/);
  assert.doesNotMatch(english, /来源报告费用|最近同步完成|未知/);
});

test('JSON and CSV remain byte-stable across all CLI languages', () => {
  const fixture = report();
  for (const format of ['json', 'csv']) {
    const baseline = formatUsageReport(fixture, format, { locale: 'zh-CN' });
    for (const locale of ['en', 'ja', 'ko']) {
      assert.equal(formatUsageReport(fixture, format, { locale }), baseline);
    }
  }
});

async function withIsolatedCli(runCase) {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-cli-locale-'));
  try {
    const env = {
      ...process.env,
      QUOTERN_DEV_ISOLATED: '1',
      QUOTERN_DATA_DIR: join(dir, 'data'),
      QUOTERN_CONFIG_HOME: join(dir, 'config-home'),
    };
    const entry = new URL(`${outputDir}/index.js`, import.meta.url);
    await runCase(fileURLToPath(entry), env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('status output uses the explicit language', async () => {
  await withIsolatedCli(async (entry, env) => {
    const status = await run(process.execPath, [entry, 'status', '--lang', 'en'], { env, timeout: 15_000 });
    assert.match(status.stdout, /Data directory:/);
    assert.match(status.stdout, /Last sync:/);
    assert.doesNotMatch(status.stdout, /数据目录|上次同步|未运行/);
  });
});

test('usage option errors use the explicit language', async () => {
  await withIsolatedCli(async (entry, env) => {
    await assert.rejects(
      run(process.execPath, [entry, 'usage', '--days', '0', '--lang', 'en'], { env, timeout: 15_000 }),
      (error) => error.code === 1 && /--days.*integer/i.test(error.stderr) && !/必须/.test(error.stderr),
    );
  });
});

test('service safety guidance uses the explicit language', async () => {
  await withIsolatedCli(async (entry, env) => {
    await assert.rejects(
      run(process.execPath, [entry, 'service', 'status', '--lang', 'en'], { env, timeout: 15_000 }),
      (error) => error.code === 1 && /disabled in isolated development mode/.test(error.stderr) && !/隔离开发/.test(error.stderr),
    );
  });
});

test('doctor maps Core natural language to a localized presentation', () => {
  const lines = [];
  const original = console.log;
  const fixture = {
    timestamp: '2026-10-17T00:00:00.000Z',
    categories: [{ id: 'storage', title: '数据存储与权限', status: 'warn',
      items: [{ id: 'storage-config', name: '配置文件', status: 'warn',
        message: 'config.json 曾损坏，已自动恢复', detail: '备份文件: C:/backup',
        suggestion: '请检查本地配置是否仍有效；确认无误后可删除备份文件。' }] }],
    collectors: { total: 1, detected: 0,
      items: [{ key: 'claude', displayName: 'Claude Code', present: false }] },
    summary: { status: 'warn', okCount: 0, warnCount: 1, errorCount: 0,
      suggestions: ['请检查本地配置是否仍有效；确认无误后可删除备份文件。'] },
  };
  try {
    console.log = (value = '') => lines.push(String(value));
    printDoctorReport(fixture, 'en');
  } finally {
    console.log = original;
  }
  const output = lines.join('\n');
  assert.match(output, /Storage and permissions/);
  assert.match(output, /config\.json/);
  assert.doesNotMatch(output, /数据存储|曾损坏|请检查|建议项/);
});
