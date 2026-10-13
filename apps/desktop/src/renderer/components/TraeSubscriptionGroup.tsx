import { TraeSubscriptionCard } from './TraeSubscriptionCard';
import type { TraeSubscriptionSnapshot } from '../../shared/trae-subscription';

/** Mounts TRAE and TRAE CN cards in a subscription grid. */
export function TraeSubscriptionGroup({
  showGlobal = true,
  showMainland = true,
}: {
  showGlobal?: boolean;
  showMainland?: boolean;
} = {}) {
  return (
    <>
      {showGlobal ? (
        <TraeSubscriptionCard
          region="global"
          title="TRAE"
          fetcher={() => window.tud.getTraeGlobalSubscription() as Promise<TraeSubscriptionSnapshot>}
        />
      ) : null}
      {showMainland ? (
        <TraeSubscriptionCard
          region="mainland"
          title="TRAE CN"
          fetcher={() => window.tud.getTraeCnSubscription() as Promise<TraeSubscriptionSnapshot>}
        />
      ) : null}
    </>
  );
}
