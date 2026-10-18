import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import {
  traeRemainingPercent,
  type TraeRegion,
  type TraeSubscriptionSnapshot,
} from '../../shared/trae-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';

const INITIAL_SNAPSHOT: TraeSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  region: 'global',
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

interface TraeSubscriptionCardProps {
  region: TraeRegion;
  title: string;
  fetcher: () => Promise<TraeSubscriptionSnapshot>;
}

/** Compact TRAE IDE entitlement summary for macOS desktop surfaces. */
export function TraeSubscriptionCard({ region, title, fetcher }: TraeSubscriptionCardProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TraeSubscriptionSnapshot>({
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
      setSnapshot({ ...INITIAL_SNAPSHOT, region, message: t('desktop.provider.readSubscription', { provider: 'TRAE' }) });
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
        icon: <SubscriptionBrandIcon brand="trae" />,
        metrics: snapshot.limits.map((limit, index) => ({
          color: ['#7dcf00', '#2b7eff', '#f59e0b'][index] ?? '#2b7eff',
          label: limit.id === 'basic'
            ? t('desktop.provider.metric.basic')
            : limit.id === 'bonus'
              ? t('desktop.provider.metric.bonus')
              : t('desktop.provider.metric.extra'),
          remainingPercent: traeRemainingPercent(limit.usedPercent),
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
