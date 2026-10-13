import type { ShareBackground } from './share-backgrounds.ts';
export interface BackgroundMigrationSource {
  list: () => Promise<ShareBackground[]>;
  legacy: () => Promise<ShareBackground[]>;
  importLegacy: (items: ShareBackground[]) => Promise<{ items: ShareBackground[]; acceptedIds: string[]; pendingIds: string[] }>;
}
export async function loadSharedBackgroundLibrary(source: BackgroundMigrationSource) {
  const shared = await source.list();
  try {
    const legacy = await source.legacy();
    if (!legacy.length) return { items: shared, migrationNotice: null, pendingCount: 0 };
    const result = await source.importLegacy(legacy);
    const pendingCount = result.pendingIds.length;
    return {
      items: result.items, pendingCount,
      migrationNotice: pendingCount ? `还有 ${pendingCount} 张旧背景待导入。共享图库最多三张，请删除不需要的背景后重试迁移；旧图已保留。` : null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '读取或导入失败';
    return { items: shared, migrationNotice: `旧背景尚未完成迁移：${reason}。旧图已保留，可重试迁移。`, pendingCount: 0 };
  }
}
