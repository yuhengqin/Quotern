import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createManualPricingExchangeRate, fetchPricingExchangeRate, needsPricingExchangeRateRefresh,
  readPricingExchangeRate, writePricingExchangeRate, type PricingCurrency, type PricingExchangeRate,
} from '../lib/pricing-currency';

export function usePricingCurrency() {
  const [currency, setCurrency] = useState<PricingCurrency>('USD');
  const [exchangeRate, setExchangeRate] = useState<PricingExchangeRate | null>(readPricingExchangeRate);
  const [exchangeStatus, setExchangeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const requestVersion = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestVersion.current += 1; };
  }, []);

  const refreshExchangeRate = useCallback(async () => {
    const version = ++requestVersion.current;
    setExchangeStatus('loading');
    try {
      const quote = await fetchPricingExchangeRate();
      if (!mounted.current || version !== requestVersion.current) return;
      writePricingExchangeRate(quote);
      setExchangeRate(quote);
      setExchangeStatus('ready');
    } catch {
      if (mounted.current && version === requestVersion.current) setExchangeStatus('error');
    }
  }, []);

  useEffect(() => {
    if (currency === 'CNY' && needsPricingExchangeRateRefresh(exchangeRate)) void refreshExchangeRate();
  }, [currency, refreshExchangeRate]);

  const setManualExchangeRate = (rate: number) => {
    const quote = createManualPricingExchangeRate(rate);
    if (!quote) return;
    requestVersion.current += 1;
    writePricingExchangeRate(quote);
    setExchangeRate(quote);
    setExchangeStatus('ready');
  };

  return { currency, setCurrency, exchangeRate, exchangeStatus, refreshExchangeRate, setManualExchangeRate };
}
