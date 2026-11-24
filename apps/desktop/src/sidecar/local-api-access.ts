const trayReads = new Set([
  '/functions/tud-quota',
  '/functions/tud-usage-summary',
  '/functions/tud-pricing',
  '/functions/tud-sync-status',
  '/functions/tud-agent-activity',
  '/functions/tud-session-detail',
]);
const pricingAdmin = new Set([
  '/functions/tud-local-admin/pricing',
  '/functions/tud-local-admin/pricing/recalculation',
]);

export function allowsLocalApiRequest(window: string, pathname: string, method: string): boolean {
  if (window === 'main') return true;
  if (window.startsWith('reference-pricing-') && pricingAdmin.has(pathname)) {
    return method === 'GET' || method === 'POST';
  }
  const reference = window.startsWith('reference-') &&
    /^\/functions\/tud-(pricing|usage-[a-z-]+|session-(list|detail|directory|activity|actions))$/.test(pathname);
  if (reference && pathname === '/functions/tud-session-actions' && method === 'POST') return true;
  return method === 'GET' && (reference || trayReads.has(pathname));
}
