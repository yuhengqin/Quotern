import assert from 'node:assert/strict';
import test from 'node:test';
import { registerMessages } from 'quotern-i18n';
import { usageMessages } from '../i18n/usage-messages.ts';
import { usageErrorDescription, usageErrorTitle } from './usage-error.ts';

registerMessages(usageMessages);

test('range failures show actionable Chinese messages instead of internal codes', () => {
  assert.equal(usageErrorDescription('INVALID_RANGE_DAYS'), '所选时间范围无法加载，请重新选择日期或重启 Quotern 后重试。');
  assert.equal(usageErrorDescription('INVALID_RANGE_DAYS:128'), usageErrorDescription('INVALID_RANGE_DAYS'));
  assert.equal(usageErrorDescription('INVALID_DATE_RANGE'), '日期范围无效，请重新选择开始日期和结束日期。');
  assert.equal(usageErrorTitle('INVALID_RANGE_DAYS'), '用量数据加载失败');
});

test('unknown service failures do not expose internal details', () => {
  for (const message of ['INTERNAL_SERVER_ERROR', 'SQLITE_BUSY: database is locked', 'GET /functions/tud-usage-daily → 500']) {
    assert.equal(usageErrorDescription(message), '用量数据加载失败，请稍后重试。');
  }
});

test('network failures explain how to retry', () => {
  assert.equal(usageErrorDescription('Failed to fetch'), '无法连接数据服务，请检查连接后重试。');
  assert.equal(usageErrorDescription('NetworkError when attempting to fetch resource.'), '无法连接数据服务，请检查连接后重试。');
});

test('empty results remain distinct from failed requests', () => {
  assert.equal(usageErrorTitle('当前时间范围暂无用量记录'), '暂无用量数据');
  assert.equal(usageErrorDescription('当前时间范围暂无用量记录'), '当前时间范围暂无用量记录');
});

test('desktop runtime recovery retains its localized status', () => {
  assert.equal(usageErrorTitle('本地服务正在恢复，请稍候'), '本地服务正在恢复，请稍候');
  assert.equal(usageErrorDescription('本地服务正在恢复，请稍候'), '本地服务正在恢复，请稍候');
});

test('localized usage errors keep semantic failure branches and hide raw diagnostics', () => {
  assert.equal(usageErrorDescription('INVALID_DATE_RANGE', 'en'), 'Invalid date range. Choose the start and end dates again.');
  assert.equal(usageErrorTitle('INVALID_RANGE_DAYS:128', 'ja'), '使用状況データを読み込めません');
  assert.equal(usageErrorDescription('SQLITE_BUSY: database is locked', 'ko'), '사용량 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
  assert.equal(usageErrorDescription('LOCAL_RUNTIME_NOT_READY', 'en'), 'The local service is recovering. Please wait.');
});
