import assert from 'node:assert/strict';
import test from 'node:test';

const outputDir = process.env.QUOTERN_CLI_TEST_DIST ?? '../dist';
const {
  formatListenUrl,
  formatSyncSourceList,
  normalizeListenHost,
  normalizeListenPort,
  parseArgs,
  resolveSyncSource,
} = await import(`${outputDir}/args.js`);

test('parseArgs reads --host and --port without defaulting them', () => {
  const parsed = parseArgs(['node', 'quotern', 'start', '--host', '0.0.0.0', '--port', '9000']);
  assert.equal(parsed.command, 'start');
  assert.equal(parsed.host, '0.0.0.0');
  assert.equal(parsed.port, 9000);
});

test('parseArgs accepts --host= form and IPv6', () => {
  const parsed = parseArgs(['node', 'quotern', 'start', '--host=::1']);
  assert.equal(parsed.host, '::1');
  assert.equal(parsed.port, undefined);
});

test('parseArgs recognizes doctor command', () => {
  const parsed = parseArgs(['node', 'quotern', 'doctor', '--port', '8452']);
  assert.equal(parsed.command, 'doctor');
  assert.equal(parsed.port, 8452);
});

test('parseArgs leaves host/port unset when omitted', () => {
  const parsed = parseArgs(['node', 'quotern', 'start']);
  assert.equal(parsed.host, undefined);
  assert.equal(parsed.port, undefined);
});

test('isolated dev launcher ownership marker does not become a user option', () => {
  const parsed = parseArgs(['node', 'quotern', 'start', '--port', '8453', '--quotern-dev-instance', 'session-123']);
  assert.equal(parsed.command, 'start');
  assert.equal(parsed.port, 8453);
});

test('quotern --host 0.0.0.0 is treated as start', () => {
  const parsed = parseArgs(['node', 'quotern', '--host', '0.0.0.0']);
  assert.equal(parsed.command, 'start');
  assert.equal(parsed.host, '0.0.0.0');
});

test('service start keeps --host', () => {
  const parsed = parseArgs(['node', 'quotern', 'service', 'start', '--host', '0.0.0.0']);
  assert.equal(parsed.command, 'service');
  assert.equal(parsed.serviceAction, 'start');
  assert.equal(parsed.host, '0.0.0.0');
});

test('normalizeListenHost rejects empty or path-like values', () => {
  assert.equal(normalizeListenHost(' 0.0.0.0 '), '0.0.0.0');
  assert.throws(() => normalizeListenHost('', 'zh-CN'), /不能为空/);
  assert.throws(() => normalizeListenHost('0.0.0.0/foo', 'zh-CN'), /无效/);
});

test('parseArgs throws when --host has no value', () => {
  assert.throws(() => parseArgs(['node', 'quotern', 'start', '--host', '--lang', 'zh-CN']), /需要地址/);
});

test('normalizeListenPort accepts only valid TCP port integers', () => {
  assert.equal(normalizeListenPort('8452'), 8452);
  assert.throws(() => normalizeListenPort('abc', 'zh-CN'), /无效的 --port/);
  assert.throws(() => normalizeListenPort('1.5', 'zh-CN'), /无效的 --port/);
  assert.throws(() => normalizeListenPort('0', 'zh-CN'), /无效的 --port/);
  assert.throws(() => normalizeListenPort('65536', 'zh-CN'), /无效的 --port/);
});

test('parseArgs rejects a missing --port value without consuming the next flag', () => {
  assert.throws(
    () => parseArgs(['node', 'quotern', 'start', '--port', '--host', '0.0.0.0', '--lang', 'zh-CN']),
    /--port 需要端口号/,
  );
});

test('formatListenUrl maps wildcard bind to loopback', () => {
  assert.equal(formatListenUrl('0.0.0.0', 8452), 'http://127.0.0.1:8452');
  assert.equal(formatListenUrl('::1', 8452), 'http://[::1]:8452');
});

test('parseArgs reads --source in both forms', () => {
  assert.equal(
    parseArgs(['node', 'quotern', 'sync', '--source', 'claude']).source,
    'claude',
  );
  assert.equal(
    parseArgs(['node', 'quotern', 'sync', '--source=codex']).source,
    'codex',
  );
});

test('resolveSyncSource maps missing/empty/all to full sweep', () => {
  assert.equal(resolveSyncSource(undefined), undefined);
  assert.equal(resolveSyncSource(''), undefined);
  assert.equal(resolveSyncSource('all'), undefined);
});

test('resolveSyncSource normalizes case and aliases', () => {
  assert.equal(resolveSyncSource(' Claude '), 'claude');
  assert.equal(resolveSyncSource('dsh'), 'dsh');
  assert.equal(resolveSyncSource('kilo'), 'kilo-cli');
  assert.equal(resolveSyncSource('qwen-code'), 'qwen');
});

test('resolveSyncSource rejects unknown sources with the valid list', () => {
  assert.throws(() => resolveSyncSource('cluade', 'zh-CN'), /未知的数据源: cluade/);
  assert.throws(() => resolveSyncSource('cluade', 'zh-CN'), /claude/);
});

test('help source list comes from the registry and keeps all + dsh', () => {
  const list = formatSyncSourceList();
  assert.ok(list.startsWith('all | '));
  assert.ok(list.includes(' dsh '));
  assert.ok(list.includes('claude'));
});
