import { useCallback, useEffect, useRef, useState } from 'react';
import { deepSeekRemainingPercent, type DeepSeekSubscriptionSnapshot } from '../../shared/deepseek-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';

const INITIAL_SNAPSHOT: DeepSeekSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

/**
 * Compact DeepSeek account balance summary for macOS desktop surfaces.
 *
 * DeepSeek reports a CNY balance using the same compact meter treatment as TRAE.
 */
export function DeepSeekSubscriptionCard() {
  const [snapshot, setSnapshot] = useState<DeepSeekSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await window.tud.getDeepSeekSubscription());
    } catch {
      setSnapshot({ ...INITIAL_SNAPSHOT, message: '暂时无法读取 DeepSeek 余额信息' });
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="deepseek" />,
        metrics: snapshot.limits.map((balance) => ({
          color: deepSeekRemainingPercent(balance.usedPercent) > 25 ? '#4f7dff' : '#ff7a45',
          label: '余额',
          remainingPercent: deepSeekRemainingPercent(balance.usedPercent),
          resetsAt: balance.resetsAt,
          valueText: balance.remaining === null ? '—' : `¥${balance.remaining.toFixed(2)}`,
        })),
        stale: snapshot.stale,
        title: 'DeepSeek',
      }}
      loading={loading}
    />
  );
}
