import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import {
  codexRemainingPercent,
  type CodexSubscriptionSnapshot,
} from '../../shared/codex-subscription';
import {
  INITIAL_CODEX_SUBSCRIPTION_STATE,
  updateCodexSubscriptionState,
} from '../lib/codex-subscription-state';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { subscriptionMessageKey } from '../i18n/desktop-subscription-messages';

const UNAVAILABLE_SNAPSHOT: CodexSubscriptionSnapshot = {
  status: 'unavailable',
  hasAccount: false,
  fetchedAt: null,
  stale: false,
  planLabel: null,
  fiveHour: null,
  weekly: null,
  message: 'desktop.provider.codexReadFailed',
};

/** Compact local ChatGPT/Codex allowance summary for macOS desktop surfaces. */
export function CodexSubscriptionCard() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState(INITIAL_CODEX_SUBSCRIPTION_STATE);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);
  const refreshOnFocus = useRef(true);
  const hasAccount = useRef(false);

  const reload = useCallback(async (forceRefresh = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    let next: CodexSubscriptionSnapshot;
    try {
      next = await window.tud.getCodexSubscription({ forceRefresh });
    } catch {
      next = { ...UNAVAILABLE_SNAPSHOT, hasAccount: hasAccount.current };
    }
    // Failed signed-in channels wait for explicit retry; absent channels can recover on focus.
    hasAccount.current = next.hasAccount;
    refreshOnFocus.current = !next.hasAccount || next.message === null;
    setState((previous) => updateCodexSubscriptionState(previous, next, Date.now()));
    requestInFlight.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => {
      if (refreshOnFocus.current) void reload();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const { snapshot, lastUpdatedAt } = state;
  if (!snapshot) return null;
  const failed = snapshot.message !== null;
  const stale = snapshot.stale;
  const messageKey = snapshot.message ? subscriptionMessageKey(snapshot.message) : null;
  const feedbackMessage = messageKey ? t(messageKey) : snapshot.message;

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="codex" />,
        metrics: [
          {
            color: '#7dcf00',
            label: '5h',
            remainingPercent: snapshot.fiveHour
              ? codexRemainingPercent(snapshot.fiveHour.usedPercent)
              : null,
            resetsAt: snapshot.fiveHour?.resetsAt,
          },
          {
            color: '#2b7eff',
            label: '7d',
            remainingPercent: snapshot.weekly
              ? codexRemainingPercent(snapshot.weekly.usedPercent)
              : null,
            resetsAt: snapshot.weekly?.resetsAt,
          },
        ],
        planLabel: snapshot.planLabel,
        hasAccount: snapshot.hasAccount,
        stale,
        title: 'Codex',
      }}
      loading={false}
      feedback={failed ? (
        <div className="grid gap-2 text-xs leading-relaxed">
          <div className="grid gap-1" role="status">
            <p className="font-medium text-foreground">{t('desktop.provider.codex.unavailable')}</p>
            <p className="break-words text-muted">{feedbackMessage ?? t('desktop.provider.codexReadFailed')}</p>
            {stale && lastUpdatedAt !== null ? (
              <p className="text-muted">
                {t('desktop.provider.codex.staleSince', {
                  date: new Intl.DateTimeFormat(i18n.resolvedLanguage || 'zh-CN', {
                    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
                  }).format(lastUpdatedAt),
                })}
              </p>
            ) : null}
            <p className="text-muted">{t('desktop.provider.codex.separateFromTokens')}</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">{t('desktop.provider.codex.autoRetryPaused')}</span>
            <Button
              aria-label={t('desktop.provider.codex.retryAria')}
              isDisabled={loading}
              isPending={loading}
              onPress={() => void reload(true)}
              size="sm"
              variant="outline"
            >
              {loading ? t('desktop.provider.retrying') : t('desktop.provider.retry')}
            </Button>
          </div>
        </div>
      ) : null}
    />
  );
}
