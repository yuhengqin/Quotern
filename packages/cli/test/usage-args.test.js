import assert from 'node:assert/strict';
import test from 'node:test';

const outputDir = process.env.QUOTERN_CLI_TEST_DIST ?? '../dist';
const { parseUsageArgs } = await import(`${outputDir}/usage-args.js`);

test('parseUsageArgs defaults to summary text output', () => {
  assert.deepEqual(parseUsageArgs([]), {
    query: { period: 'summary' },
    format: 'text',
    dataDir: undefined,
    help: false,
  });
});

test('overview is an explicit multidimensional query and accepts the same filters', () => {
  const parsed = parseUsageArgs(['overview', '--days', '7', '--source', 'codex', '--project', 'Quotern', '--json', '--compact']);
  assert.deepEqual(parsed.query, { period: 'overview', days: 7, sources: ['codex'], project: 'Quotern' });
  assert.equal(parsed.compact, true);
});

test('parseUsageArgs accepts the supported options and normalizes their values', () => {
  assert.deepEqual(
    parseUsageArgs([
      'daily',
      '--days',
      '30',
      '--source',
      ' Claude, dsh,claude,codex ',
      '--model',
      '  gpt-5  ',
      '--project=my project',
      '--data-dir',
      '  C:/usage data  ',
      '--format',
      'csv',
    ]),
    {
      query: {
        period: 'daily',
        days: 30,
        sources: ['claude', 'dsh', 'codex'],
        model: 'gpt-5',
        project: 'my project',
      },
      format: 'csv',
      dataDir: 'C:/usage data',
      help: false,
    },
  );
});

test('parseUsageArgs accepts equals forms and a valid date range', () => {
  assert.deepEqual(
    parseUsageArgs([
      'weekly',
      '--from=2026-02-28',
      '--to=2026-03-01',
      '--source=codex',
      '--model=gpt-5',
      '--project=Quotern',
      '--data-dir=C:/usage',
      '--format=json',
    ]),
    {
      query: {
        period: 'weekly',
        fromDate: '2026-02-28',
        toDate: '2026-03-01',
        sources: ['codex'],
        model: 'gpt-5',
        project: 'Quotern',
      },
      format: 'json',
      dataDir: 'C:/usage',
      help: false,
    },
  );
});

test('parseUsageArgs supports all as an alias for all sources', () => {
  assert.equal(parseUsageArgs(['--source', 'ALL']).query.sources, undefined);
});

test('parseUsageArgs accepts both inclusive day-count boundaries', () => {
  assert.equal(parseUsageArgs(['--days=1']).query.days, 1);
  assert.equal(parseUsageArgs(['--days', '3660']).query.days, 3660);
});

test('parseUsageArgs reports help', () => {
  assert.equal(parseUsageArgs(['--help']).help, true);
  assert.equal(parseUsageArgs(['-h']).help, true);
});

test('compact is a JSON presentation option and never enters the Core query', () => {
  for (const args of [
    ['models', '--days', '7', '--format', 'json', '--compact'],
    ['--compact', 'models', '--days=7', '--json'],
  ]) {
    const parsed = parseUsageArgs(args);
    assert.deepEqual(parsed.query, { period: 'models', days: 7 });
    assert.equal(parsed.format, 'json');
    assert.equal(parsed.compact, true);
  }
  for (const args of [
    ['--compact'], ['--csv', '--compact'], ['--compact', '--format=text'],
    ['--json', '--compact', '--compact'], ['--json', '--compact=true'],
  ]) assert.throws(() => parseUsageArgs([...args, '--lang', 'zh-CN']), /compact/);
});

test('parseUsageArgs validates dates and date-range constraints', () => {
  for (const args of [
    ['--from', '2026-02-30', '--to', '2026-03-01'],
    ['--from', '2026-03-02', '--to', '2026-03-01'],
    ['--from', '2026-03-01'],
    ['--to', '2026-03-01'],
    ['--from', '2026-03-01', '--to', '2026-03-02', '--days', '7'],
    ['--from=2026/03/01', '--to=2026-03-02'],
  ]) {
    assert.throws(() => parseUsageArgs([...args, '--lang', 'zh-CN']), /日期|--from|--to|--days/);
  }
});

test('parseUsageArgs validates periods, days, formats, sources, and positionals', () => {
  for (const args of [
    ['quarterly'],
    ['daily', 'monthly'],
    ['--days', '0'],
    ['--days=3661'],
    ['--days', '1.5'],
    ['--format', 'yaml'],
    ['--json', '--csv'],
    ['--source', 'all,claude'],
    ['--unknown'],
    ['daily', 'extra'],
  ]) {
    assert.throws(() => parseUsageArgs([...args, '--lang', 'zh-CN']), /周期|参数|格式|数据源|位置|整数|支持/);
  }
});

test('parseUsageArgs rejects missing, empty, and repeated option values', () => {
  for (const args of [
    ['--days'],
    ['--days', '--from', '2026-01-01'],
    ['--from='],
    ['--source', ''],
    ['--model='],
    ['--project', '  '],
    ['--data-dir='],
    ['--format='],
    ['--days', '7', '--days', '8'],
    ['--from', '2026-01-01', '--from', '2026-01-02', '--to', '2026-01-03'],
    ['--source=claude', '--source=codex'],
    ['--model=a', '--model=b'],
    ['--project=a', '--project=b'],
    ['--data-dir=a', '--data-dir=b'],
    ['--format=json', '--format=json'],
    ['--json', '--format=json'],
  ]) {
    assert.throws(() => parseUsageArgs([...args, '--lang', 'zh-CN']), /缺少|不能为空|重复|冲突|需要/);
  }
});
