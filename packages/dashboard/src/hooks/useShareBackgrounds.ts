import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import { defaultBackground, type ShareBackground } from '../lib/share-backgrounds';
import { loadBackgroundLibrary, shareBackgroundStore } from '../lib/share-background-client';
import type { BackgroundMigrationNotice } from '../lib/share-background-migration';
import { isDemoMode } from '../lib/demo-runtime';

export function useShareBackgrounds() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ShareBackground[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<BackgroundMigrationNotice | null>(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const initialized = useRef(false);
  const editing = useRef(false);
  const setEditing = useCallback((value: boolean) => { editing.current = value; }, []);

  const reload = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loadBackgroundLibrary();
      const saved = result.items;
      if (mounted.current && request === generation.current) {
        setItems(saved);
        const first = !initialized.current;
        setSelectedId((id) => first ? defaultBackground(saved)?.id ?? null : id === null || saved.some((item) => item.id === id) ? id : defaultBackground(saved)?.id ?? null);
        initialized.current = true;
        setMigrationNotice(result.migrationNotice);
        setReady(true);
      }
    } catch {
      if (mounted.current && request === generation.current) {
        setReady(false);
        setError('share.backgroundLoadError');
      }
    } finally {
      if (request === generation.current) {
        locked.current = false;
        if (mounted.current) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current++; locked.current = false; };
  }, [reload]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden && !editing.current) void reload(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [reload]);

  const run = useCallback(async (operation: () => Promise<ShareBackground[]>, select?: (items: ShareBackground[]) => string | null) => {
    if (isDemoMode()) throw new Error('DEMO_READ_ONLY');
    if (locked.current) throw new Error('share.backgroundBusy');
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
      if (mounted.current) setError('share.backgroundSaveError');
      throw failure;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const select = useCallback((id: string | null) => {
    if (locked.current || loading || (id !== null && !ready)) return;
    setSelectedId(id);
    if (id && !isDemoMode()) void run(() => shareBackgroundStore.touch(id), (saved) => saved.some((item) => item.id === id) ? id : defaultBackground(saved)?.id ?? null).catch(() => undefined);
  }, [ready, loading, run]);

  return {
    items, selectedId, ready, loading, busy, error, readOnly: isDemoMode(),
    migrationNotice: migrationNotice ? t(migrationNotice.key, migrationNotice) : null,
    reload, select, setEditing,
    markUsed: (id: string) => {
      if (!locked.current && !isDemoMode()) void run(() => shareBackgroundStore.touch(id)).catch(() => undefined);
    },
    add: (name: string, blob: Blob, replaceId?: string) => run(() => shareBackgroundStore.add(name, blob, replaceId), (saved) => defaultBackground(saved)?.id ?? null),
    remove: (id: string) => run(() => shareBackgroundStore.remove(id)),
  };
}
