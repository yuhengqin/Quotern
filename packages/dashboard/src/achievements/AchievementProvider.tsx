import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AchievementSnapshot, AchievementOperation, AchievementNotice, AchievementPreferences } from 'quotern-core/achievements';
import { useAppToastQueue } from '@/components/AppToastContext';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import type { AchievementShareSelection } from './share-model';

type AchievementRequest = (operation: AchievementOperation) => Promise<{ snapshot: AchievementSnapshot; notice?: AchievementNotice }>;
interface AchievementContextValue {
  snapshot: AchievementSnapshot | null; loading: boolean; busy: boolean; error: string | null;
  refresh: () => Promise<void>; openDetails: (id: string) => void; openCelebration: (ids: string[]) => void;
  updatePreferences: (preferences: Partial<AchievementPreferences>) => Promise<void>;
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
  const queue = useAppToastQueue();
  const [snapshot, setSnapshot] = useState<AchievementSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [detailIds, setDetailIds] = useState<string[]>([]);
  const [shareSelection, setShareSelection] = useState<AchievementShareSelection | null>(null);
  const alive = useRef(true), serial = useRef(0), applied = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const apply = useCallback(async (operation: AchievementOperation) => {
    const sequence = ++serial.current;
    const result = await request(operation);
    if (alive.current && sequence >= applied.current) { applied.current = sequence; setSnapshot(result.snapshot); }
    return result;
  }, [request]);
  const openCelebration = useCallback((ids: string[]) => {
    setDetailIds(ids);
    const owned = ids.filter(id => snapshotRef.current?.earned.some(item => item.id === id));
    if (owned.length) void apply({ operation: 'seen', ids: owned }).catch(() => queue.add({ title: '已读状态未保存，可稍后重试', variant: 'warning' }));
  }, [apply, queue]);
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
            title: result.notice.historical ? '你的记录，已经值得收藏' : ids.length === 1 ? '新成就已点亮' : '新点亮 ' + ids.length + ' 枚成就',
            description: result.notice.historical ? '从已有记录中发现了 ' + ids.length + ' 枚成就。' : ids.length === 1 ? result.snapshot.earned.find(item => item.id === ids[0])?.title : '这些同行的时刻，已为你保存。',
            actionProps: { children: '查看成就', onPress: () => openCelebration(ids) },
          }, { timeout: 8000 });
        }
      } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '成就收藏暂时不可用'); }
      finally { if (alive.current) setLoading(false); }
    })();
    inFlight.current = pending;
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null; });
    return pending;
  }, [apply, openCelebration, queue]);
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
    catch (reason) { queue.add({ title: reason instanceof Error ? reason.message : '设置保存失败，请重试', variant: 'danger' }); throw reason; }
    finally { if (alive.current) setBusy(false); }
  }, [apply, queue]);
  const value = useMemo<AchievementContextValue>(() => ({
    snapshot, loading, busy, error, refresh, updatePreferences, detailIds, openCelebration,
    openDetails: id => openCelebration([id]), closeDetails: () => setDetailIds([]), shareSelection,
    share: selection => { setDetailIds([]); setShareSelection(selection); }, closeShare: () => setShareSelection(null),
  }), [snapshot, loading, busy, error, refresh, updatePreferences, detailIds, openCelebration, shareSelection]);
  return <AchievementContext.Provider value={value}>{children}</AchievementContext.Provider>;
}
