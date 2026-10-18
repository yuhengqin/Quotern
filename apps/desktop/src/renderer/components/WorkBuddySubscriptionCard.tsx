import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import {
  workBuddyRemainingPercent,
  type WorkBuddyRegion,
  type WorkBuddySubscriptionSnapshot,
} from '../../shared/workbuddy-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';

const INITIAL_SNAPSHOT: WorkBuddySubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  region: 'global',
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

interface WorkBuddySubscriptionCardProps {
  region: WorkBuddyRegion;
  title: string;
  fetcher: () => Promise<WorkBuddySubscriptionSnapshot>;
}

/** Compact WorkBuddy account resource summary for macOS desktop surfaces. */
export function WorkBuddySubscriptionCard({ region, title, fetcher }: WorkBuddySubscriptionCardProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<WorkBuddySubscriptionSnapshot>({
    ...INITIAL_SNAPSHOT,
    region,
  });
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await fetcher());
    } catch {
      setSnapshot({ ...INITIAL_SNAPSHOT, region, message: t('desktop.provider.readSubscription', { provider: 'WorkBuddy' }) });
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [fetcher, region, t]);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="workbuddy" />,
        metrics: snapshot.limits.slice(0, 2).map((limit, index) => ({
          color: index === 0 && snapshot.limits.length > 1 ? '#7dcf00' : '#2b7eff',
          label: workBuddyLabel(limit.label, t),
          remainingPercent: workBuddyRemainingPercent(limit.usedPercent),
          resetsAt: limit.resetsAt,
        })),
        planLabel: snapshot.planLabel,
        stale: snapshot.stale,
        title,
      }}
      loading={loading}
    />
  );
}

function workBuddyLabel(label: string, t: ReturnType<typeof useTranslation>['t']): string {
  const normalized = label.toLowerCase();
  if (normalized === 'credits' || normalized === '积分') return t('desktop.provider.metric.credits');
  if (normalized === 'bonus' || normalized === '赠送') return t('desktop.provider.metric.bonus');
  return label;
}
