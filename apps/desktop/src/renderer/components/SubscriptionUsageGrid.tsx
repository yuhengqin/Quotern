import { Card } from '@heroui/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import { QuotaUsageCard } from './QuotaUsageCard';
import { QuotaProfilesManager } from './QuotaProfilesManager';
import { useQuotaState } from '../hooks/useQuotaState';
import { distinctQuotaAllowances, isQuotaStatusOnly, resolveQuotaNavigation } from '../lib/quota-presentation';
import { useQuotaNavigation } from '../hooks/useQuotaNavigation';
import { QuotaLayoutControl, QuotaLayoutItem } from '../../../../../packages/dashboard/src/components/QuotaLayoutControl';
import { useQuotaLayout } from '../../../../../packages/dashboard/src/hooks/useQuotaLayout';

interface SubscriptionUsageGridProps {
  className?: string;
  summaryOnly?: boolean;
}

/** Shared subscription allowance cards used by the desktop dashboard and tray. */
export function SubscriptionUsageGrid({ className = '', summaryOnly = false }: SubscriptionUsageGridProps) {
  const { t } = useTranslation();
  const { state, error, save } = useQuotaState();
  const request = useQuotaNavigation();
  const [handledId, setHandledId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const visible = state?.providers.filter(provider => provider.profileLabel || provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status)) ?? [];
  const allowances = distinctQuotaAllowances(visible.filter(provider => !isQuotaStatusOnly(provider)));
  const editor = useQuotaLayout(allowances, state?.preferences, save);
  const statuses = visible.filter(isQuotaStatusOnly);
  const target = request ? resolveQuotaNavigation(request, [...allowances, ...statuses]) : null;
  const navigation = request ? { ...request, handled: handledId === request.requestId } : undefined;
  const handled = (id: string) => { setHandledId(id); void window.tud.acknowledgeQuotaNavigation?.(id).catch(() => {}); };
  useEffect(() => {
    if (!request || !state) return;
    setMissing(!target);
    if (!target && handledId !== request.requestId) handled(request.requestId);
  }, [request, state, handledId, target]);
  if (!state) return error ? <p role="status" className="text-xs text-muted">{t(error)}</p> : null;

  return (
    <section
      ref={editor.rootRef}
      aria-label={t('usage.quota.gridAria')}
      className={`grid items-stretch empty:hidden ${className}`.trim()}
    >
      {!summaryOnly && <div className="col-span-full -mb-1 flex flex-wrap items-center justify-end gap-2"><QuotaLayoutControl editor={editor} hasStatuses={statuses.length > 0} />{!editor.editing && <QuotaProfilesManager preferences={state.preferences} providers={state.providers} onSave={save} />}</div>}
      {missing && <p role="status" className="col-span-full text-xs text-warning">{t('island.quota.navigationUnavailable')}</p>}
      {editor.ordered.map(provider => <QuotaLayoutItem key={provider.id} provider={provider} editor={editor}>{controls => <QuotaUsageCard provider={provider} preferences={{ ...state.preferences, compact: editor.compact }} layoutControls={controls} onSave={save} summaryOnly={summaryOnly} navigation={target?.id === provider.id ? navigation : undefined} onNavigationHandled={handled} />}</QuotaLayoutItem>)}
      {statuses.length > 0 && <Card data-quota-status-group role="group" aria-label={t('usage.quota.statusGroup')} variant="secondary"
        className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${allowances.length ? '' : 'col-span-full grid-cols-subgrid'}`.trim()}>
        {statuses.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} onSave={save} statusRow navigation={target?.id === provider.id ? navigation : undefined} onNavigationHandled={handled} />)}
      </Card>}
      {((error && !editor.error) || state.notice) && <p role="status" className="col-span-full text-xs text-warning">{error ? t(error) : t('usage.quota.noticeGeneric')}</p>}
    </section>
  );
}
