import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import {
  openCodeRemainingPercent,
  type OpenCodeSubscriptionSnapshot,
} from '../../shared/opencode-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';

const INITIAL_SNAPSHOT: OpenCodeSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

/** Compact OpenCode Go subscription allowance summary for macOS desktop surfaces. */
export function OpenCodeSubscriptionCard() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<OpenCodeSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await window.tud.getOpenCodeSubscription());
    } catch {
      setSnapshot({ ...INITIAL_SNAPSHOT, message: t('desktop.provider.readSubscription', { provider: 'OpenCode Go' }) });
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="opencode" />,
        metrics: snapshot.limits.map((limit, index) => ({
          color: index === 0 && snapshot.limits.length > 1 ? '#7dcf00' : '#2b7eff',
          label: limit.id === 'monthly' ? t('desktop.provider.metric.monthlyLimit') : limit.label,
          remainingPercent: openCodeRemainingPercent(limit.usedPercent),
          resetsAt: limit.resetsAt,
        })),
        planLabel: snapshot.planLabel,
        stale: snapshot.stale,
        title: 'OpenCode',
      }}
      loading={loading}
    />
  );
}
