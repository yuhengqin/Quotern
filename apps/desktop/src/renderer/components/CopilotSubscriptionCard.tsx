import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import type { CopilotSubscriptionSnapshot } from '../../shared/copilot-subscription';
import { SubscriptionUsageCard, type SubscriptionUsageMetric } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';

const INITIAL_SNAPSHOT: CopilotSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

/** GitHub Copilot allowances from the locally signed-in account. */
export function CopilotSubscriptionCard() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<CopilotSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await window.tud.getCopilotSubscription());
    } catch {
      setSnapshot({
        ...INITIAL_SNAPSHOT,
        message: t('desktop.provider.readSubscription', { provider: 'Copilot' }),
      });
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

  const metrics: SubscriptionUsageMetric[] = snapshot.limits.map((limit) => ({
    color: limit.id === 'completions' ? '#7dcf00' : '#2b7eff',
    label: limit.label === '额度'
      ? t('desktop.provider.metric.allowance')
      : limit.id === 'chat'
        ? t('desktop.provider.metric.chat')
        : limit.id === 'completions'
          ? t('desktop.provider.metric.completions')
          : limit.id === 'premium_interactions'
            ? t('desktop.provider.metric.premium')
            : limit.label,
    remainingPercent: limit.exhausted ? 0 : limit.unlimited ? 100 : limit.remainingPercent,
    resetsAt: limit.resetsAt,
    valueText: limit.exhausted
      ? t('desktop.provider.value.exhausted')
      : limit.unlimited ? t('desktop.provider.value.unlimited') : undefined,
  }));

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="copilot" />,
        metrics,
        planLabel: snapshot.planLabel,
        stale: snapshot.stale,
        title: snapshot.planLabel === 'Free' ? 'Copilot Free' : 'Copilot',
      }}
      loading={loading}
    />
  );
}
