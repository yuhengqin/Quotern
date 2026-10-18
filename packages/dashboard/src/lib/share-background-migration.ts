import type { ShareBackground } from './share-backgrounds.ts';
export interface BackgroundMigrationSource {
  list: () => Promise<ShareBackground[]>;
  legacy: () => Promise<ShareBackground[]>;
  importLegacy: (items: ShareBackground[]) => Promise<{ items: ShareBackground[]; acceptedIds: string[]; pendingIds: string[] }>;
}
export type BackgroundMigrationNotice =
  | { key: 'share.migrationPending'; count: number }
  | { key: 'share.migrationFailed' };

export async function loadSharedBackgroundLibrary(source: BackgroundMigrationSource) {
  const shared = await source.list();
  try {
    const legacy = await source.legacy();
    if (!legacy.length) return { items: shared, migrationNotice: null, pendingCount: 0 };
    const result = await source.importLegacy(legacy);
    const pendingCount = result.pendingIds.length;
    return {
      items: result.items, pendingCount,
      migrationNotice: pendingCount ? { key: 'share.migrationPending' as const, count: pendingCount } : null,
    };
  } catch {
    return { items: shared, migrationNotice: { key: 'share.migrationFailed' as const }, pendingCount: 0 };
  }
}
