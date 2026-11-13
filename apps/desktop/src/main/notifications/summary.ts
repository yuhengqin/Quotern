import { randomUUID } from 'node:crypto';
import type { SupportedLocale } from 'quotern-i18n';
import type { DesktopNotice } from '../../shared/notifications.js';
import { notificationText } from '../../shared/notification-messages.js';

export function summarizeNotices(notices: DesktopNotice[], locale: SupportedLocale): DesktopNotice {
  const categories = new Set(notices.map(notice => notice.category));
  const kind = categories.size > 1 ? 'mixed' : notices[0]!.category;
  const titles = notices.slice(0, 3).map(notice => Array.from(notice.title.replace(/[\x00-\x1f\x7f]/g, ' ')).slice(0, 180).join(''));
  if (notices.length > 3) titles.push(notificationText(locale, 'summary.more', { count: String(notices.length - 3) }));
  return {
    id: randomUUID(), category: notices[0]!.category,
    title: notificationText(locale, `summary.${kind}`, { count: String(notices.length) }), body: titles.join('\n'),
    target: { kind: 'quota' }, snoozable: notices.some(notice => notice.snoozable !== false), occurredAt: Date.now(),
  };
}
