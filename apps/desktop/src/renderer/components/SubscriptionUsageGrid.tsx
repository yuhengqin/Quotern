import { Card } from '@heroui/react';
import { useEffect, useState } from 'react';
import { normalizeLocale } from 'quotern-i18n';
import { localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaState } from '../../shared/quota';
import { selectTrayQuota } from '../../shared/tray-quota-summary';
import { QuotaUsageCard } from './QuotaUsageCard';
import { QuotaProfilesManager } from './QuotaProfilesManager';
import { useQuotaState } from '../hooks/useQuotaState';
import { distinctQuotaAllowances, isQuotaStatusOnly, resolveQuotaNavigation } from '../lib/quota-presentation';
import { useQuotaNavigation } from '../hooks/useQuotaNavigation';
import { QuotaLayoutControl, orderQuotaProviders } from '../../../../../packages/dashboard/src/components/QuotaLayoutControl';
import { formatSubscriptionCountdown, formatSubscriptionResetTime } from '../../../../../packages/dashboard/src/lib/subscription-time';

interface SubscriptionUsageGridProps {
  className?: string;
  summaryOnly?: boolean;
  compact?: boolean;
}

/** Shared subscription allowance cards used by the desktop dashboard and tray. */
export function SubscriptionUsageGrid({ className = '', summaryOnly = false, compact = false }: SubscriptionUsageGridProps) {
  const { t } = useTranslation();
  const { state, error, save } = useQuotaState();
  const request = useQuotaNavigation();
  const [handledId, setHandledId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const visible = state?.providers.filter(provider => provider.profileLabel || provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status)) ?? [];
  const allowances = orderQuotaProviders(distinctQuotaAllowances(visible.filter(provider => !isQuotaStatusOnly(provider))), state?.preferences.providerOrder);
  const statuses = visible.filter(isQuotaStatusOnly);
  const target = request ? resolveQuotaNavigation(request, [...allowances, ...statuses]) : null;
  const navigation = request ? { ...request, handled: handledId === request.requestId } : undefined;
  const handled = (id: string) => { setHandledId(id); void window.tud.acknowledgeQuotaNavigation?.(id).catch(() => {}); };
  useEffect(() => {
    if (compact || !request || !state) return;
    setMissing(!target);
    if (!target && handledId !== request.requestId) handled(request.requestId);
  }, [compact, request, state, handledId, target]);
  if (compact) return <TrayQuotaSummary state={state} error={error} />;
  if (!state) return error ? <p role="status" className="text-xs text-muted">{t(error)}</p> : null;

  return (
    <section
      aria-label={t('usage.quota.gridAria')}
      className={`grid items-stretch empty:hidden ${className}`.trim()}
    >
      {!summaryOnly && <div className="col-span-full -mb-1 flex flex-wrap justify-end gap-1"><QuotaLayoutControl preferences={state.preferences} providers={allowances} onSave={save} /><QuotaProfilesManager preferences={state.preferences} providers={state.providers} onSave={save} /></div>}
      {missing && <p role="status" className="col-span-full text-xs text-warning">{t('island.quota.navigationUnavailable')}</p>}
      {allowances.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} onSave={save} summaryOnly={summaryOnly} navigation={target?.id === provider.id ? navigation : undefined} onNavigationHandled={handled} />)}
      {statuses.length > 0 && <Card data-quota-status-group role="group" aria-label={t('usage.quota.statusGroup')} variant="secondary"
        className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${allowances.length ? '' : 'col-span-full grid-cols-subgrid'}`.trim()}>
        {statuses.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} onSave={save} statusRow navigation={target?.id === provider.id ? navigation : undefined} onNavigationHandled={handled} />)}
      </Card>}
      {(error || state.notice) && <p role="status" className="col-span-full text-xs text-warning">{error ? t(error) : t('usage.quota.noticeGeneric')}</p>}
    </section>
  );
}

function TrayQuotaSummary({ state, error }: { state: QuotaState | null; error: string | null }) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const providers = distinctQuotaAllowances(state?.providers ?? []);
  const selected = selectTrayQuota(providers, { now: now.getTime() / 1000, providerOrder: state?.preferences.providerOrder });
  if (!selected) {
    const status = error ?? (!state ? 'desktop.tray.quotaLoading'
      : selectTrayQuota(providers) ? 'usage.quota.awaitingUpdate'
      : providers.some(provider => provider.stale && provider.windows.length) ? 'usage.quota.stale'
      : 'desktop.tray.noQuota');
    return <p role="status" className="tray-popover__summary text-sm text-muted">{t(status)}</p>;
  }

  const { provider, window: quota } = selected;
  const label = provider.label;
  const period = localizeQuotaWindowLabel(locale, provider.providerId ?? provider.id, quota);
  const dateMode = state?.preferences.resetTimeMode === 'date';
  const expiry = quota.timeKind === 'expiry';
  const reset = dateMode ? formatSubscriptionResetTime(quota.resetsAt, now, false, locale) : formatSubscriptionCountdown(quota.resetsAt, now, locale);
  const deadline = reset && (dateMode ? `${reset} ${t(expiry ? 'usage.quota.expiry' : 'usage.quota.reset')}`
    : t(expiry ? 'usage.quota.expiresIn' : 'usage.quota.resetsIn', { time: reset }));
  const remaining = 100 - quota.usedPercent;
  const color = remaining <= 10 ? 'bg-danger' : remaining <= 30 ? 'bg-warning' : 'bg-accent';
  return (
    <section aria-label={t('usage.quota.gridAria')} className="tray-popover__summary grid gap-0.5">
      <div className="flex min-w-0 items-center justify-between gap-2 text-sm font-semibold">
        <span className="min-w-0 truncate" title={label}>{label}</span>
        <span className="shrink-0 tabular-nums">{t('usage.quota.remaining', { percent: Math.round(remaining) })}</span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate" title={period}>{period}</span>
        {deadline && <span className="shrink-0 tabular-nums" title={formatSubscriptionResetTime(quota.resetsAt, now, true, locale) ?? undefined}>{deadline}</span>}
      </div>
      {error ? <p role="status" className="text-xs text-warning">{t(error)}</p> : (
        <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-default">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${remaining}%` }} />
        </div>
      )}
    </section>
  );
}
