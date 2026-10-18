import { useEffect, useState } from 'react';
import { rollingDayRange } from '@/lib/dashboard-date-range';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';

/** All cards and requests share one clock boundary; resume advances it too. */
export function useRollingDayRange(active: boolean) {
  const [range, setRange] = useState(rollingDayRange);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (!document.hidden) setRange(rollingDayRange()); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener(DATA_SYNCED_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(DATA_SYNCED_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [active]);
  return active ? range : null;
}
