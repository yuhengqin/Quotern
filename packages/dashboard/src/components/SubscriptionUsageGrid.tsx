import { useTranslation } from 'quotern-i18n/react';
import { QuotaUsageCard } from './QuotaUsageCard';
import { useQuotaState } from '../hooks/useQuotaState';
import { distinctQuotaAllowances, isQuotaStatusOnly } from '../lib/quota-presentation';
import { QuotaProfilesManager } from './QuotaProfilesManager';
import { BillingPanel } from './BillingPanel';
import { AgentActivityButton } from './AgentActivityPanel';
import { QuotaLayoutControl, QuotaLayoutCards } from './QuotaLayoutControl';
import { useQuotaLayout } from '../hooks/useQuotaLayout';

export function SubscriptionUsageGrid({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { state, error, refresh, save } = useQuotaState();
  const visible = state?.providers.filter(provider => provider.profileLabel || provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status)) ?? [];
  const allowances = distinctQuotaAllowances(visible.filter(provider => !isQuotaStatusOnly(provider)));
  const statuses = visible.filter(isQuotaStatusOnly);
  const editor = useQuotaLayout([...allowances, ...statuses], state?.preferences, save);
  if (!state) return error ? <p role="status" className="mt-4 text-xs text-muted">{t(error)}</p> : null;
  return <section ref={editor.rootRef} aria-label={t('usage.quota.gridAria')} className={`grid items-stretch empty:hidden ${className}`.trim()}>
    <div className="col-span-full -mb-1 flex flex-wrap items-center justify-end gap-2"><QuotaLayoutControl editor={editor} />{!editor.editing && <><AgentActivityButton /><BillingPanel /><QuotaProfilesManager preferences={state.preferences} providers={state.providers} onSave={save} /></>}</div>
    <QuotaLayoutCards editor={editor}>{(provider, controls, statusRow) => <QuotaUsageCard provider={provider} preferences={{ ...state.preferences, compact: editor.compact }} layoutControls={controls} statusRow={statusRow} onRefresh={refresh} onSave={save} />}</QuotaLayoutCards>
    {((error && !editor.error) || state.notice) && <p role="status" className="col-span-full text-xs text-warning">{error ? t(error) : t('usage.quota.noticeGeneric')}</p>}
  </section>;
}
