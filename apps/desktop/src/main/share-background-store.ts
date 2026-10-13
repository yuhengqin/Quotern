import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedShareBackground } from '../shared/share-backgrounds.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function validateBackgroundImage(image: unknown): asserts image is string {
  if (typeof image !== 'string' || image.length > MAX_IMAGE_BYTES * 4 / 3 + 100) throw new Error('背景图片超过 2 MB');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) throw new Error('背景图片格式无效');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > MAX_IMAGE_BYTES) throw new Error('背景图片内容无效或超过 2 MB');
}

/** One bounded snapshot makes replacement atomic, including the actual image bytes. */
export class ShareBackgroundFileStore {
  private readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) { this.file = join(directory, 'share-backgrounds.json'); }

  private async read(): Promise<SavedShareBackground[]> {
    try {
      const raw = await readFile(this.file, 'utf8');
      if (raw.length > 9_000_000) throw new Error('背景图库过大');
      const items: unknown = JSON.parse(raw);
      if (!Array.isArray(items) || items.length > 3) throw new Error('背景图库格式无效');
      const ids = new Set<string>();
      for (const item of items) {
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string'
          || !Number.isFinite(item.createdAt) || !Number.isFinite(item.lastUsedAt) || ids.has(item.id)) throw new Error('背景图库格式无效');
        validateBackgroundImage(item.image);
        ids.add(item.id);
      }
      return items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('无法读取已保存的背景图库，原文件已保留', { cause: error });
    }
  }

  private enqueue(update?: (items: SavedShareBackground[]) => SavedShareBackground[]): Promise<SavedShareBackground[]> {
    const result = this.pending.then(async () => {
      const items = await this.read();
      if (!update) return items;
      const next = update(items);
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, this.file);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw new Error('背景保存失败，原来的图片已保留。请检查存储空间后重试', { cause: error });
      }
      return next;
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  list() { return this.enqueue(); }
  add(input: { name: string; image: string }, replaceId?: string) {
    return this.enqueue((items) => {
      validateBackgroundImage(input?.image);
      if (typeof input.name !== 'string' || input.name.length > 200) throw new Error('背景名称无效');
      if (replaceId && !items.some(({ id }) => id === replaceId)) throw new Error('要替换的背景已不存在，请重新选择');
      if (!replaceId && items.length >= 3) throw new Error('已保存三张背景，请选择要替换的一张');
      const createdAt = Math.max(Date.now(), ...items.map((item) => item.createdAt + 1));
      return [...items.filter(({ id }) => id !== replaceId), { name: input.name, image: input.image, id: randomUUID(), createdAt, lastUsedAt: createdAt }];
    });
  }
  remove(id: string) { return this.enqueue((items) => items.filter((item) => item.id !== id)); }
  touch(id: string) {
    return this.enqueue((items) => items.map((item) => item.id === id ? { ...item, lastUsedAt: Date.now() } : item));
  }
}
