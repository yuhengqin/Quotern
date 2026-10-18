import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import {
  kimiRemainingPercent,
  type KimiSubscriptionSnapshot,
} from '../../shared/kimi-subscription';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { selectKimiSubscription } from '../lib/kimi-subscription-state';
import { subscriptionMessageKey } from '../i18n/desktop-subscription-messages';

/** A single Kimi subscription card backed by independent local readers. */
export function KimiSubscriptionCard() {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState<KimiSubscriptionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async (forceRefresh = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    try {
      setSnapshots(await window.tud.getKimiSubscription({ forceRefresh }));
    } catch {
      setSnapshots([]);
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

  const snapshot = selectKimiSubscription(snapshots);
  if (!snapshot) return null;
  const title = 'Kimi';
  const messageKey = snapshot.message ? subscriptionMessageKey(snapshot.message) : null;
  const feedback = snapshot.message
    ? messageKey ? t(messageKey) : snapshot.message
    : snapshot.limits.length === 0 ? t('desktop.provider.kimi.noAllowance') : null;

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="kimi" />,
        metrics: snapshot.limits.map((limit, index) => ({
          color: index === 0 && snapshot.limits.length > 1 ? '#7dcf00' : '#2b7eff',
          label: limit.id === 'subscription'
            ? t('desktop.provider.metric.subscriptionAllowance')
            : limit.label,
          remainingPercent: kimiRemainingPercent(limit.usedPercent),
          resetsAt: limit.resetsAt,
        })),
        planLabel: snapshot.planLabel,
        showFreePlan: true,
        stale: snapshot.stale,
        title,
      }}
      loading={false}
      feedback={feedback ? (
        <div className="grid gap-2 text-xs leading-relaxed">
          <p className="break-words text-muted" role="status">{feedback}</p>
          <Button
            aria-label={t('desktop.provider.kimi.retryAria')}
            className="justify-self-start"
            isDisabled={loading}
            isPending={loading}
            onPress={() => void reload(true)}
            size="sm"
            variant="outline"
          >
            {loading ? t('desktop.provider.retrying') : t('desktop.provider.retry')}
          </Button>
        </div>
      ) : null}
    />
  );
}
