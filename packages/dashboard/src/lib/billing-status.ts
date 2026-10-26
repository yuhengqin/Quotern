/** Keep partial sums visible while also exposing a failed pagination attempt. */
export function billingStatusMessage(status: string, code: string | null): string | null {
  if (status === 'not-configured') return 'notConfigured';
  if (status === 'not-queried') return 'notQueried';
  if (status !== 'unavailable' && (status !== 'partial' || !code || code === 'MISSING_AMOUNT')) return null;
  return code === 'HTTP_401' || code === 'HTTP_403' ? 'denied' : code === 'HTTP_429' ? 'limited' : 'unavailable';
}
