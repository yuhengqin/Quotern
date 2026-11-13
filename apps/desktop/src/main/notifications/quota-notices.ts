import { randomUUID } from 'node:crypto';
import type { SupportedLocale } from 'quotern-i18n';
import { localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import type { QuotaNotification } from 'quotern-core/quota/readers/quota-manager';
import type { QuotaServiceNotification, QuotaState, QuotaPreferences } from '../../shared/quota.js';
import type { DesktopNotice } from '../../shared/notifications.js';
import { notificationText } from '../../shared/notification-messages.js';
import { nativeText } from '../native-messages.js';

const selectionKey = (selected?: readonly string[]) => JSON.stringify(selected === undefined ? null : [...selected].sort());
const plain = (text: string, limit: number) => Array.from(text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity]!).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');

export function quotaNotice(value: QuotaNotification, locale: SupportedLocale, now = Date.now()): DesktopNotice {
  const reset = value.kind === 'reset';
  const vars = { provider: value.label, window: localizeQuotaWindowLabel(locale, value.provider, {
    id: value.windowId, label: value.windowLabel, groupLabel: value.windowGroupLabel, periodSeconds: value.windowPeriodSeconds,
  }), percent: reset ? Math.round(100 - value.usedPercent) : value.kind === 'depleted' ? 100 : Number(value.kind.slice(10)) };
  const time = value.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  return {
    id: randomUUID(), category: 'quota',
    title: nativeText(locale, reset ? 'native.quota.resetTitle' : value.kind === 'depleted' ? 'native.quota.depletedTitle' : 'native.quota.thresholdTitle', vars),
    body: nativeText(locale, reset ? 'native.quota.resetBody' : 'native.quota.thresholdBody', vars) + (time ? nativeText(locale, 'native.quota.resetsAt', { time }) : ''),
    target: { kind: 'quota', value: { providerId: value.providerId ?? value.provider, providerType: value.provider, windowId: value.windowId, accountRef: value.accountRef } },
    replaceKey: JSON.stringify(['quota', value.provider, value.accountRef ?? value.providerId ?? value.provider, value.windowId]),
    occurredAt: now, expiresAt: reset ? now + 600_000 : Math.min(now + 86400_000, value.resetsAt && value.resetsAt * 1000 > now ? value.resetsAt * 1000 : Infinity),
    snoozable: !reset, context: { kind: 'quota', alert: value.kind, resetsAt: value.resetsAt, epoch: value.notificationEpoch },
  };
}

export function serviceNotice(value: QuotaServiceNotification, locale: SupportedLocale, selected?: readonly string[], now = Date.now()): DesktopNotice {
  const recovered = value.level === 'operational';
  const components = (value.components ?? []).filter(component => component.level !== 'operational' && (selected === undefined || selected.includes(component.id)));
  const incident = [...(value.incidents ?? [])].filter(item => selected === undefined || !item.componentIds.length || item.componentIds.some(id => selected.includes(id)))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const body = recovered ? notificationText(locale, 'serviceRecoveredBody') : [
    notificationText(locale, `level.${value.level}`),
    components.slice(0, 3).map(component => plain(component.name, 80)).join(' · '),
    incident ? [plain(incident.name, 100), plain(incident.body, 220)].filter(Boolean).join(' — ') : '',
  ].filter(Boolean).join('\n');
  return { id: randomUUID(), category: 'service',
    title: nativeText(locale, recovered ? 'native.quota.serviceRestored' : 'native.quota.serviceIssue', { provider: value.label }), body,
    target: { kind: 'quota', value: { providerId: value.provider, providerType: value.provider } },
    replaceKey: JSON.stringify(['service', value.provider]), occurredAt: now, expiresAt: now + (recovered ? 600_000 : 86400_000), snoozable: !recovered,
    context: { kind: 'service', level: value.level, selection: selectionKey(selected), label: value.label },
  };
}

/** Reconcile even when Core intentionally emits no new notification. Unknown is never recovery. */
export function isQuotaNoticeCurrent(notice: DesktopNotice, state: QuotaState, now = Date.now()): boolean {
  if (notice.expiresAt !== undefined && notice.expiresAt <= now) return false;
  const context = notice.context, target = notice.target?.kind === 'quota' ? notice.target.value : undefined;
  if (!context || !target) return true;
  const preferences = state.preferences;
  if (preferences.channels[target.providerType as keyof QuotaPreferences['channels']] === false) return false;
  let candidates = state.providers.filter(provider => (provider.providerId ?? provider.id) === target.providerType);
  if (context.kind === 'service') {
    if (preferences.serviceAlerts === false || !candidates.length || selectionKey(preferences.serviceComponents?.[target.providerType as keyof NonNullable<QuotaPreferences['serviceComponents']>]) !== context.selection) return false;
    const current = candidates.map(provider => provider.service).find(service => service && !service.stale && service.level !== 'unknown');
    return !current || current.level === context.level;
  }
  if (context.alert === 'reset' ? !preferences.resetAlerts : !preferences.thresholdAlerts) return false;
  if (target.accountRef) {
    const rule = preferences.accountAlerts?.[`${target.providerType}:${target.accountRef}`];
    if (rule?.level === 'off') return false;
    if (context.alert.startsWith('threshold-') && (rule?.level === 'critical' || rule?.level === 'custom' && !rule.thresholds?.includes(Number(context.alert.slice(10))))) return false;
    candidates = candidates.filter(provider => provider.provenance?.identityVerified && provider.provenance.accountRef === target.accountRef);
  } else candidates = candidates.filter(provider => provider.id === target.providerId);
  candidates = candidates.filter(provider => !preferences.profiles?.some(profile => `${profile.provider}@${profile.id}` === provider.id && (!profile.enabled || profile.alerts === false)));
  if (!candidates.length) return false;
  // Prefer the newest successful reading across duplicate directories, as the quota cards do.
  const provider = candidates.sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0))[0]!;
  if (!target.accountRef && context.epoch !== undefined && provider.notificationEpoch !== context.epoch) return false;
  if (provider.stale || provider.status === 'temporarily-unavailable' || provider.refreshing) return true;
  if (provider.status !== 'ready') return false;
  const window = provider.windows.find(window => window.id === target.windowId);
  if (!window || window.analysisEligible === false) return false;
  if (window.resetsAt !== null && context.resetsAt !== null && window.resetsAt > context.resetsAt + 60) return false;
  if (context.alert === 'reset') return true;
  return window.usedPercent >= (context.alert === 'depleted' ? 100 : Number(context.alert.slice(10)));
}

/** Content-only changes never trigger an alert, but a requested reminder must use current data. */
export function resolveQuotaReminder(notice: DesktopNotice, state: QuotaState, locale: SupportedLocale, now = Date.now()): DesktopNotice | null {
  if (!isQuotaNoticeCurrent(notice, state, now)) return null;
  const context = notice.context, target = notice.target?.kind === 'quota' ? notice.target.value : undefined;
  if (!context || !target) return notice;
  const candidates = state.providers.filter(provider => (provider.providerId ?? provider.id) === target.providerType);
  if (context.kind === 'service') {
    const service = candidates.map(provider => provider.service).find(service => service && !service.stale && service.level !== 'unknown');
    if (!service) return null;
    const selected = state.preferences.serviceComponents?.[target.providerType as keyof NonNullable<QuotaPreferences['serviceComponents']>];
    const latest = serviceNotice({ ...service, provider: target.providerType, label: context.label }, locale, selected, now);
    return { ...notice, title: latest.title, body: latest.body };
  }
  const provider = candidates.filter(provider => target.accountRef ? provider.provenance?.identityVerified && provider.provenance.accountRef === target.accountRef : provider.id === target.providerId)
    .filter(provider => provider.status === 'ready' && !provider.stale).sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0))[0];
  const window = provider?.windows.find(window => window.id === target.windowId);
  if (!provider || !window) return null;
  const latest = quotaNotice({ provider: target.providerType, providerId: provider.id, accountRef: target.accountRef, label: provider.label, window: window.label, windowId: window.id, windowLabel: window.label, windowGroupLabel: window.groupLabel, windowPeriodSeconds: window.periodSeconds ?? window.durationSeconds ?? null, kind: context.alert, resetsAt: window.resetsAt, usedPercent: window.usedPercent }, locale, now);
  return { ...notice, title: latest.title, body: latest.body };
}
