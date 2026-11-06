import { Card } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { QuotaUsageCard } from './QuotaUsageCard';
import { useQuotaState } from '../hooks/useQuotaState';
import { distinctQuotaAllowances, isQuotaStatusOnly } from '../lib/quota-presentation';
import { QuotaProfilesManager } from './QuotaProfilesManager';
import { QuotaLayoutControl, orderQuotaProviders } from './QuotaLayoutControl';

export function SubscriptionUsageGrid({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { state, error, refresh, save } = useQuotaState();
  if (!state) return error ? <p role="status" className="mt-4 text-xs text-muted">{t(error)}</p> : null;
  const visible = state.providers.filter(provider => provider.profileLabel || provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status));
  const allowances = orderQuotaProviders(distinctQuotaAllowances(visible.filter(provider => !isQuotaStatusOnly(provider))), state.preferences.providerOrder);
  const statuses = visible.filter(isQuotaStatusOnly);
  return <section aria-label={t('usage.quota.gridAria')} className={`grid items-stretch empty:hidden ${className}`.trim()}>
    <div className="col-span-full -mb-1 flex flex-wrap justify-end gap-1"><QuotaLayoutControl preferences={state.preferences} providers={allowances} onSave={save} /><QuotaProfilesManager preferences={state.preferences} providers={state.providers} onSave={save} /></div>
    {allowances.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} onRefresh={refresh} />)}
    {statuses.length > 0 && <Card data-quota-status-group role="group" aria-label={t('usage.quota.statusGroup')} variant="secondary" className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${allowances.length ? '' : 'col-span-full grid-cols-subgrid'}`.trim()}>
      {statuses.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} statusRow onRefresh={refresh} />)}
    </Card>}
    {(error || state.notice) && <p role="status" className="col-span-full text-xs text-warning">{error ? t(error) : t('usage.quota.noticeGeneric')}</p>}
  </section>;
}
