import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeNotices } from './summary.js';
import type { DesktopNotice } from '../../shared/notifications.js';

test('summary localizes counts and opens the quota overview while keeping a bounded preview', () => {
  const items: DesktopNotice[] = Array.from({ length: 5 }, (_, index) => ({ id: String(index), category: index % 2 ? 'service' : 'quota', title: `账号 ${index}`, body: 'Details', snoozable: index !== 0 }));
  for (const [locale, title, more] of [['zh-CN', '5 项额度与服务提醒', '另有 2 项'], ['en', '5 quota and service alerts', '2 more'], ['ja', '利用枠・サービスの通知 5 件', 'ほか 2 件'], ['ko', '할당량 및 서비스 알림 5개', '외 2개']] as const) {
    const summary = summarizeNotices(items, locale);
    assert.equal(summary.title, title); assert.match(summary.body, new RegExp(more));
    assert.match(summary.body, /账号 0/); assert.doesNotMatch(summary.body, /账号 3/);
    assert.deepEqual(summary.target, { kind: 'quota' }); assert.equal(summary.snoozable, true);
  }
});

test('a summary of recovery notices does not offer another reminder', () => {
  const items: DesktopNotice[] = [{ id: 'a', category: 'quota', title: 'Reset', body: 'Ready', snoozable: false }, { id: 'b', category: 'quota', title: 'Reset B', body: 'Ready', snoozable: false }];
  const summary = summarizeNotices(items, 'zh-CN');
  assert.equal(summary.title, '2 项额度提醒'); assert.equal(summary.snoozable, false);
});
