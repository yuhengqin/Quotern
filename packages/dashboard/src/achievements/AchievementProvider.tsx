import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AchievementSnapshot, AchievementOperation, AchievementNotice, AchievementPreferences, AchievementFamily } from 'quotern-core/achievements';
import { normalizeLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { useAppToastQueue } from '@/components/AppToastContext';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { dismissTransientOverlays } from '../lib/overlay-dismiss';
import type { AchievementShareSelection } from './share-model';
import { createAchievementRequestQueue } from './request-queue';
import { achievementDisplayName } from './view-model';

type AchievementRequest = (operation: AchievementOperation) => Promise<{ snapshot: AchievementSnapshot; notice?: AchievementNotice }>;
interface AchievementContextValue {
  snapshot: AchievementSnapshot | null; loading: boolean; busy: boolean; error: string | null;
  refresh: () => Promise<void>; openDetails: (id: string) => void; openCelebration: (ids: string[]) => void;
  updatePreferences: (preferences: Partial<AchievementPreferences>) => Promise<void>;
  updateProject: (operation: Omit<Extract<AchievementOperation, { operation: 'project' }>, 'operation'>) => Promise<void>;
  familyDetail: AchievementFamily | null; openFamily: (family: AchievementFamily) => void; closeFamily: () => void;
  detailIds: string[]; closeDetails: () => void;
  shareSelection: AchievementShareSelection | null; share: (selection: AchievementShareSelection) => void; closeShare: () => void;
}
const AchievementContext = createContext<AchievementContextValue | null>(null);
export function useAchievements(): AchievementContextValue {
  const value = useContext(AchievementContext);
  if (!value) throw new Error('AchievementProvider is required');
  return value;
}
export function AchievementProvider({ request, children }: { request: AchievementRequest; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const queue = useAppToastQueue();
  const [snapshot, setSnapshot] = useState<AchievementSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [detailIds, setDetailIds] = useState<string[]>([]);
  const [familyDetail, setFamilyDetail] = useState<AchievementFamily | null>(null);
  const [shareSelection, setShareSelection] = useState<AchievementShareSelection | null>(null);
  const alive = useRef(true);
  const requestInOrder = useMemo(() => createAchievementRequestQueue(request), [request]);
  const inFlight = useRef<Promise<void> | null>(null);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const apply = useCallback(async (operation: AchievementOperation) => {
    const result = await requestInOrder(operation);
    if (alive.current) setSnapshot(result.snapshot);
    return result;
  }, [requestInOrder]);
  const openCelebration = useCallback((ids: string[], keepFamily = false) => {
    dismissTransientOverlays();
    if (!keepFamily) setFamilyDetail(null);
    setDetailIds(ids);
    const owned = ids.filter(id => snapshotRef.current?.earned.some(item => item.id === id));
    if (owned.length) void apply({ operation: 'seen', ids: owned }).catch(() => queue.add({ title: t('achievement.notice.seenFailed'), variant: 'warning' }));
  }, [apply, queue, t]);
  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const pending = (async () => {
      try {
        const result = await apply({ operation: 'claim-notice' });
        if (!alive.current) return;
        setError(null);
        if (result.notice?.ids.length) {
          const ids = result.notice.ids;
          queue.add({
            title: result.notice.historical ? t('achievement.notice.historicalTitle') : ids.length === 1 ? t('achievement.notice.singleTitle') : t('achievement.notice.multiTitle', { count: ids.length }),
            description: result.notice.historical ? t('achievement.notice.historicalDescription', { count: ids.length }) : ids.length === 1 ? (() => { const item = result.snapshot.earned.find(item => item.id === ids[0]); return item ? achievementDisplayName(item, true, locale) : undefined; })() : t('achievement.notice.multiDescription'),
            actionProps: { children: t('achievement.notice.view'), onPress: () => openCelebration(ids) },
          }, { timeout: 8000 });
        }
      } catch { if (alive.current) setError(t('achievement.notice.unavailable')); }
      finally { if (alive.current) setLoading(false); }
    })();
    inFlight.current = pending;
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null; });
    return pending;
  }, [apply, openCelebration, queue, t, locale]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSync = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 400); };
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const calendar = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    window.addEventListener(DATA_SYNCED_EVENT, onSync);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive.current = false; clearTimeout(timer); clearInterval(calendar); window.removeEventListener(DATA_SYNCED_EVENT, onSync); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);
  const updatePreferences = useCallback(async (preferences: Partial<AchievementPreferences>) => {
    setBusy(true);
    try { await apply({ operation: 'preferences', ...preferences }); }
    catch (reason) { queue.add({ title: t('achievement.notice.settingsFailed'), variant: 'danger' }); throw reason; }
    finally { if (alive.current) setBusy(false); }
  }, [apply, queue, t]);
  const updateProject = useCallback(async (operation: Omit<Extract<AchievementOperation, { operation: 'project' }>, 'operation'>) => {
    setBusy(true);
    try { await apply({ operation: 'project', ...operation }); }
    catch (reason) { queue.add({ title: t('achievement.notice.projectFailed'), variant: 'danger' }); throw reason; }
    finally { if (alive.current) setBusy(false); }
  }, [apply, queue, t]);
  const value = useMemo<AchievementContextValue>(() => ({
    snapshot, loading, busy, error, refresh, updatePreferences, updateProject, detailIds, openCelebration, familyDetail,
    openFamily: family => { setShareSelection(null); setDetailIds([]); setFamilyDetail(family); }, closeFamily: () => setFamilyDetail(null),
    openDetails: id => openCelebration([id], true), closeDetails: () => setDetailIds([]), shareSelection,
    share: selection => { setFamilyDetail(null); setDetailIds([]); setShareSelection(selection); }, closeShare: () => setShareSelection(null),
  }), [snapshot, loading, busy, error, refresh, updatePreferences, updateProject, detailIds, openCelebration, shareSelection, familyDetail]);
  return <AchievementContext.Provider value={value}>{children}</AchievementContext.Provider>;
}
