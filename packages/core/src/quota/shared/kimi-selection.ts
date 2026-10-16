import type { KimiSubscriptionSnapshot } from './kimi-subscription.js';

/** Select one complete account/source; never add shared pools from different readers. */
export function selectKimiSubscription(snapshots: KimiSubscriptionSnapshot[]): KimiSubscriptionSnapshot | null {
  const visible = snapshots.filter(isKimiSubscriptionVisible);
  let candidates = visible.filter(snapshot => snapshot.status === 'ready');
  if (!candidates.length) return visible.find(snapshot => snapshot.planLabel === 'Free')
    ?? visible.find(snapshot => snapshot.status === 'custom-provider') ?? visible[0] ?? null;
  const priorities: ((snapshot: KimiSubscriptionSnapshot) => boolean)[] = [
    snapshot => !snapshot.stale, snapshot => snapshot.limits.length > 0,
    snapshot => snapshot.planLabel !== null,
    snapshot => snapshot.limits.some(limit => limit.id === 'subscription' || limit.id === 'limit_month_total'),
    snapshot => snapshot.source === 'code',
  ];
  for (const prefer of priorities) { const preferred = candidates.filter(prefer); if (preferred.length) candidates = preferred; }
  return candidates[0];
}
export function isKimiSubscriptionVisible(snapshot: KimiSubscriptionSnapshot | null): snapshot is KimiSubscriptionSnapshot {
  if (!snapshot || ['not-installed', 'not-signed-in', 'expired'].includes(snapshot.status)) return false;
  return snapshot.status !== 'temporarily-unavailable' || snapshot.fetchedAt !== null || snapshot.planLabel === 'Free';
}
