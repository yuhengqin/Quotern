/** Only the pricing hash of the current trusted renderer may receive a preload. */
export function isReferencePricingUrl(target: string, current: string): boolean {
  return trustedReferenceRoute(target, current)?.pathname === '/pricing';
}

/** Only exact session targets in the current document may inherit the local IPC preload. */
export function isReferenceSessionUrl(target: string, current: string): boolean {
  const route = trustedReferenceRoute(target, current);
  const source = route?.searchParams.get('sessionSource'), id = route?.searchParams.get('sessionId');
  return route?.pathname === '/sessions' && ['codex', 'claude', 'dsh'].includes(source ?? '')
    && Boolean(id && id.length <= 512 && !/[\u0000-\u001f]/.test(id));
}

function trustedReferenceRoute(target: string, current: string): URL | null {
  try {
    const next = new URL(target), entry = new URL(current);
    if (!['file:', 'http:', 'https:'].includes(entry.protocol)
      || next.protocol !== entry.protocol || next.host !== entry.host
      || next.pathname !== entry.pathname || next.search !== entry.search
      || next.username || next.password) return null;
    const route = new URL(next.hash.slice(1), 'https://quotern.invalid');
    return next.hash.startsWith('#/') && route.origin === 'https://quotern.invalid' ? route : null;
  } catch {
    return null;
  }
}
