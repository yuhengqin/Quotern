import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultBackground, shareBackgroundStore, type ShareBackground } from '../lib/share-backgrounds';

export function useShareBackgrounds() {
  const [items, setItems] = useState<ShareBackground[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setReady(false);
    setLoading(true);
    setSelectedId(null);
    setError(null);
    try {
      const saved = await shareBackgroundStore.list();
      if (mounted.current && request === generation.current) {
        setItems(saved);
        setSelectedId(defaultBackground(saved)?.id ?? null);
        setReady(true);
      }
    } catch (failure) {
      if (mounted.current && request === generation.current) setError(failure instanceof Error ? failure.message : '读取背景失败，请重试');
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current++; };
  }, [reload]);

  const run = useCallback(async (operation: () => Promise<ShareBackground[]>, select?: (items: ShareBackground[]) => string | null) => {
    if (locked.current) throw new Error('背景正在保存，请稍候');
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await operation();
      if (mounted.current) {
        setItems(saved);
        setSelectedId((id) => select ? select(saved) : id === null || saved.some((item) => item.id === id) ? id : defaultBackground(saved)?.id ?? null);
      }
      return saved;
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '保存背景失败，请重试');
      throw failure;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const select = useCallback((id: string | null) => {
    if (locked.current || loading || (id !== null && !ready)) return;
    setSelectedId(id);
    if (id) void run(() => shareBackgroundStore.touch(id), (saved) => saved.some((item) => item.id === id) ? id : defaultBackground(saved)?.id ?? null).catch(() => undefined);
  }, [ready, loading, run]);

  return {
    items, selectedId, ready, loading, busy, error, reload, select,
    markUsed: (id: string) => {
      if (!locked.current) void run(() => shareBackgroundStore.touch(id)).catch(() => undefined);
    },
    add: (name: string, blob: Blob, replaceId?: string) => run(() => shareBackgroundStore.add(name, blob, replaceId), (saved) => defaultBackground(saved)?.id ?? null),
    remove: (id: string) => run(() => shareBackgroundStore.remove(id)),
  };
}
