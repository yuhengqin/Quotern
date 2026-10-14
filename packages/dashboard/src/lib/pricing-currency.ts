export type PricingCurrency = 'USD' | 'CNY';

export interface PricingExchangeRate {
  rate: number;
  date: string | null;
  source: 'frankfurter' | 'manual';
  fetchedAt: number;
}

export const PRICING_EXCHANGE_RATE_URL = 'https://api.frankfurter.dev/v2/rate/USD/CNY';
export const PRICING_EXCHANGE_RATE_STORAGE_KEY = 'quotern.pricing.exchange-rate.v1';

const AUTO_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function isPricingExchangeRate(value: unknown): value is PricingExchangeRate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const quote = value as Record<string, unknown>;
  if (typeof quote.rate !== 'number' || !Number.isFinite(quote.rate) || quote.rate <= 0) return false;
  if (typeof quote.fetchedAt !== 'number' || !Number.isFinite(quote.fetchedAt) || quote.fetchedAt < 0) return false;
  if (quote.source === 'manual') return quote.date === null;
  return quote.source === 'frankfurter' && isRealIsoDate(quote.date);
}

function getReadStorage(storage?: Pick<Storage, 'getItem'>): Pick<Storage, 'getItem'> | null {
  if (storage) return storage;
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function getWriteStorage(storage?: Pick<Storage, 'setItem'>): Pick<Storage, 'setItem'> | null {
  if (storage) return storage;
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPricingExchangeRate(
  storage?: Pick<Storage, 'getItem'>,
): PricingExchangeRate | null {
  try {
    const target = getReadStorage(storage);
    if (!target) return null;
    const stored = target.getItem(PRICING_EXCHANGE_RATE_STORAGE_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isPricingExchangeRate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePricingExchangeRate(
  quote: PricingExchangeRate,
  storage?: Pick<Storage, 'setItem'>,
): void {
  if (!isPricingExchangeRate(quote)) return;
  try {
    const target = getWriteStorage(storage);
    target?.setItem(PRICING_EXCHANGE_RATE_STORAGE_KEY, JSON.stringify(quote));
  } catch {
    // Storage can be disabled or full; callers keep the in-memory quote.
  }
}

export function needsPricingExchangeRateRefresh(
  quote: PricingExchangeRate | null,
  now = Date.now(),
): boolean {
  if (quote === null || !isPricingExchangeRate(quote)) return true;
  if (quote.source === 'manual') return false;
  if (!Number.isFinite(now) || now < 0) return true;
  return now - quote.fetchedAt > AUTO_REFRESH_INTERVAL_MS
    || quote.fetchedAt - now > FUTURE_CLOCK_TOLERANCE_MS;
}

export function createManualPricingExchangeRate(
  rate: number,
  now = Date.now(),
): PricingExchangeRate | null {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(now) || now < 0) return null;
  return { rate, date: null, source: 'manual', fetchedAt: now };
}

export async function fetchPricingExchangeRate(
  fetcher: typeof fetch = globalThis.fetch,
  now = Date.now(),
): Promise<PricingExchangeRate> {
  if (!Number.isFinite(now) || now < 0) throw new Error('汇率时间无效');

  let response: Response;
  try {
    response = await fetcher(PRICING_EXCHANGE_RATE_URL, {
      signal: AbortSignal.timeout(4500),
    });
  } catch {
    throw new Error('汇率请求失败');
  }
  if (!response.ok) throw new Error('汇率请求失败');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('汇率数据无效');
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('汇率数据无效');
  }
  const result = payload as Record<string, unknown>;
  if (
    result.base !== 'USD'
    || result.quote !== 'CNY'
    || typeof result.rate !== 'number'
    || !Number.isFinite(result.rate)
    || result.rate <= 0
    || !isRealIsoDate(result.date)
  ) {
    throw new Error('汇率数据无效');
  }

  return {
    rate: result.rate,
    date: result.date,
    source: 'frankfurter',
    fetchedAt: now,
  };
}

export function formatConvertedPricingRate(
  value: number | null,
  currency: PricingCurrency = 'USD',
  exchangeRate: number | null = null,
): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—';

  let convertedValue = value;
  let symbol = '$';
  if (currency === 'CNY') {
    if (exchangeRate === null || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return '—';
    convertedValue *= exchangeRate;
    if (!Number.isFinite(convertedValue)) return '—';
    symbol = '¥';
  }

  const formatted = new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 6,
    useGrouping: true,
  }).format(convertedValue);
  return `${symbol}${formatted}`;
}
