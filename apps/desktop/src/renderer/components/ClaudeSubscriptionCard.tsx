import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import {
  claudeRemainingPercent,
  type ClaudeSubscriptionSnapshot,
} from '../../shared/claude-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { subscriptionMessageKey } from '../i18n/desktop-subscription-messages';

const INITIAL_SNAPSHOT: ClaudeSubscriptionSnapshot = {
  status: 'authorization-required',
  planLabel: null,
  hasAccount: false,
  fiveHour: null,
  sevenDay: null,
  fetchedAt: null,
  stale: false,
  message: null,
};

/** Claude Code allowance summary with actionable failures for signed-in accounts. */
export function ClaudeSubscriptionCard() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ClaudeSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await window.tud.getClaudeSubscription({
        allowCredentialAccess: true,
      }));
    } catch {
      setSnapshot({
        ...INITIAL_SNAPSHOT,
        status: 'temporarily-unavailable',
        message: t('desktop.provider.readSubscription', { provider: 'Claude' }),
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

  const messageKey = snapshot.message ? subscriptionMessageKey(snapshot.message) : null;

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="claude" />,
        metrics: [
          {
            color: '#7dcf00',
            label: '5h',
            remainingPercent: snapshot.fiveHour
              ? claudeRemainingPercent(snapshot.fiveHour.usedPercent)
              : null,
            resetsAt: snapshot.fiveHour?.resetsAt,
          },
          {
            color: '#2b7eff',
            label: '7d',
            remainingPercent: snapshot.sevenDay
              ? claudeRemainingPercent(snapshot.sevenDay.usedPercent)
              : null,
            resetsAt: snapshot.sevenDay?.resetsAt,
          },
        ],
        planLabel: snapshot.planLabel,
        hasAccount: snapshot.hasAccount,
        message: messageKey ? t(messageKey) : snapshot.message,
        stale: snapshot.stale,
        title: 'Claude',
      }}
      loading={loading}
    />
  );
}
