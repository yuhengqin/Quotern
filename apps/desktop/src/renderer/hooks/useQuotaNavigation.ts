import { useEffect, useState } from 'react';
import type { QuotaNavigationRequest } from '../../shared/quota-navigation';

export function useQuotaNavigation() {
  const [request, setRequest] = useState<QuotaNavigationRequest | null>(null);
  useEffect(() => {
    const api = window.tud;
    if (!api?.getQuotaNavigation || !api.onQuotaNavigation) return;
    let disposed = false, reading = false, again = false;
    const read = () => {
      again = true;
      if (reading) return;
      reading = true;
      void (async () => {
        while (again && !disposed) {
          again = false;
          const next = await api.getQuotaNavigation();
          if (!disposed && next) setRequest(next);
        }
      })().catch(() => {}).finally(() => { reading = false; });
    };
    const unsubscribe = api.onQuotaNavigation(read);
    read();
    return () => { disposed = true; unsubscribe(); };
  }, []);
  return request;
}
