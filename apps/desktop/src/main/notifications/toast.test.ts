import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowsToast } from './toast.js';

test('toast escapes upstream text and supplies real protocol actions and explicit silence', () => {
  const xml = buildWindowsToast({ title: 'A & B <error>\u0000', body: 'Details "quoted"', viewUrl: 'quotern-test://view/id?token=one&n=2', snoozeUrl: 'quotern-test://snooze/id?token=one', viewLabel: '查看详情', snoozeLabel: '30 分钟后提醒' });
  assert.match(xml, /A &amp; B &lt;error&gt;/); assert.doesNotMatch(xml, /\u0000/);
  assert.match(xml, /<audio silent="true"/);
  assert.match(xml, /content="查看详情" activationType="protocol"/);
  assert.match(xml, /content="30 分钟后提醒" activationType="protocol"/);
  assert.match(xml, /token=one&amp;n=2/);
});

test('invalid Unicode cannot turn a valid alert into malformed XML', () => {
  const xml = buildWindowsToast({ title: 'API 🚨', body: `upstream ${String.fromCharCode(0xd800)} text`, viewUrl: 'quotern-test://view/id', viewLabel: '查看详情', snoozeLabel: '' });
  assert.equal(Buffer.from(xml, 'utf8').toString('utf8'), xml);
  assert.match(xml, /API 🚨/);
});
