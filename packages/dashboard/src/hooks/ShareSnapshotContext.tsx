import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import type { SharePosterDetails } from '../components/SharePosterArtwork';
import type { ShareDashboardData, ShareFilters } from '../lib/share-snapshot';

export interface ShareSnapshot {
  data: ShareDashboardData;
  filters: ShareFilters;
  loading: boolean;
  error: string | null;
  details?: SharePosterDetails;
  rangeLabel: string;
  summary: DashboardUsageSummary;
  toolLabel: string;
}

interface ShareSnapshotContextValue {
  publishSnapshot: (snapshot: ShareSnapshot) => void;
  snapshot: ShareSnapshot | null;
}

const ShareSnapshotContext = createContext<ShareSnapshotContextValue | null>(null);

export function ShareSnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const publishSnapshot = useCallback((next: ShareSnapshot) => {
    setSnapshot(next);
  }, []);
  const value = useMemo(
    () => ({ publishSnapshot, snapshot }),
    [publishSnapshot, snapshot],
  );

  return (
    <ShareSnapshotContext.Provider value={value}>
      {children}
    </ShareSnapshotContext.Provider>
  );
}

export function useShareSnapshot(): ShareSnapshotContextValue {
  const value = useContext(ShareSnapshotContext);
  if (!value) {
    throw new Error('useShareSnapshot must be used within ShareSnapshotProvider');
  }
  return value;
}
