import { useCallback, useEffect, useState } from 'react';
import type { QuotaPreferencePatch, QuotaState } from '../../shared/quota';
import { readSubscriptionChannelVisibility } from '../../shared/subscription-channels';

export function useQuotaState() {
  const [state, setState] = useState<QuotaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const bridge = window.tud?.quota;
    if (!bridge) return;
    let active = true, received = false;
    const unsubscribe = bridge.onChanged(next => { received = true; if (active) setState(next); });
    const load = async () => {
      try {
        const next = await bridge.getState();
        if (!active) return;
        if (!received) setState(next);
        setError(null);
        const legacy = readSubscriptionChannelVisibility();
        if (!Object.keys(next.preferences.channels).length && Object.keys(legacy).length) {
          await bridge.setPreferences({ channels: legacy });
        }
      } catch { if (active) setError('usage.quota.loadFailed'); }
    };
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', load); };
  }, []);
  const save = useCallback(async (patch: QuotaPreferencePatch) => {
    try { const next = await window.tud.quota.setPreferences(patch); setState(next); setError(null); }
    catch (cause) { setError('usage.quota.saveFailed'); throw cause; }
  }, []);
  return { state, error, save };
}
