import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedShareBackground } from '../shared/share-backgrounds';

/** Legacy source only. Core owns all new writes; this file is kept as a migration backup. */
export async function readDesktopLegacyBackgrounds(directory: string): Promise<SavedShareBackground[]> {
  const file = join(directory, 'share-backgrounds.json');
  try {
    if ((await stat(file)).size > 9_000_000) throw new Error('旧图库过大');
    const items: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(items) || items.length > 3 || items.some((item) => !item
      || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.image !== 'string'
      || !Number.isFinite(item.createdAt) || !Number.isFinite(item.lastUsedAt))) throw new Error('旧图库格式无效');
    // Core independently validates image contents and records import receipts.
    return items;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('无法读取旧 Desktop 背景图库，原文件已保留', { cause: error });
  }
}
