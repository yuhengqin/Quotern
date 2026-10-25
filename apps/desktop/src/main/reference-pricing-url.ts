/** Only the pricing hash of the current trusted renderer may receive a preload. */
export function isReferencePricingUrl(target: string, current: string): boolean {
  try {
    const next = new URL(target), entry = new URL(current);
    if (!['file:', 'http:', 'https:'].includes(entry.protocol)
      || next.protocol !== entry.protocol || next.host !== entry.host
      || next.pathname !== entry.pathname || next.search !== entry.search
      || next.username || next.password) return false;
    const route = new URL(next.hash.slice(1), 'https://quotern.invalid');
    return next.hash.startsWith('#/') && route.origin === 'https://quotern.invalid' && route.pathname === '/pricing';
  } catch {
    return false;
  }
}
