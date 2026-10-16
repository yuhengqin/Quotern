import { QuotaUsageCard } from './QuotaUsageCard';
import { useQuotaState } from '../hooks/useQuotaState';

interface SubscriptionUsageGridProps {
  className?: string;
}

/** Shared subscription allowance cards used by the desktop dashboard and tray. */
export function SubscriptionUsageGrid({ className = '' }: SubscriptionUsageGridProps) {
  const { state, error } = useQuotaState();
  if (!state) return error ? <p role="status" className="text-xs text-muted">{error}</p> : null;
  const visible = state.providers.filter(provider => provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status));

  return (
    <section
      aria-label="订阅额度"
      className={`grid items-stretch empty:hidden ${className}`.trim()}
    >
      {visible.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} />)}
      {state.notice && <p role="status" className="col-span-full text-xs text-warning">{state.notice}</p>}
    </section>
  );
}
