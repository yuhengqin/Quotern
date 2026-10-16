import { Card } from '@heroui/react';
import { QuotaUsageCard } from './QuotaUsageCard';
import { QuotaProfilesManager } from './QuotaProfilesManager';
import { useQuotaState } from '../hooks/useQuotaState';
import { isQuotaStatusOnly } from '../lib/quota-presentation';

interface SubscriptionUsageGridProps {
  className?: string;
}

/** Shared subscription allowance cards used by the desktop dashboard and tray. */
export function SubscriptionUsageGrid({ className = '' }: SubscriptionUsageGridProps) {
  const { state, error, save } = useQuotaState();
  if (!state) return error ? <p role="status" className="text-xs text-muted">{error}</p> : null;
  const visible = state.providers.filter(provider => provider.profileLabel || provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status));
  const allowances = visible.filter(provider => !isQuotaStatusOnly(provider));
  const statuses = visible.filter(isQuotaStatusOnly);

  return (
    <section
      aria-label="订阅额度"
      className={`grid items-stretch empty:hidden ${className}`.trim()}
    >
      <div className="col-span-full -mb-1 flex justify-end"><QuotaProfilesManager preferences={state.preferences} onSave={save} /></div>
      {allowances.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} />)}
      {statuses.length > 0 && <Card data-quota-status-group role="group" aria-label="订阅状态" variant="secondary"
        className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${allowances.length ? '' : 'col-span-full grid-cols-subgrid'}`.trim()}>
        {statuses.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} statusRow />)}
      </Card>}
      {state.notice && <p role="status" className="col-span-full text-xs text-warning">{state.notice}</p>}
    </section>
  );
}
