import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { imageSize } from 'image-size';

export const MAX_SHARE_BACKGROUNDS = 3;
export const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
export const MAX_BACKGROUND_REQUEST_BYTES = 9 * 1024 * 1024;
export const SHARE_BACKGROUNDS_ROUTE = '/functions/tud-share-backgrounds';

export interface SavedShareBackground {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  image: string;
}
export interface ShareBackgroundImportResult {
  items: SavedShareBackground[];
  acceptedIds: string[];
  pendingIds: string[];
}
interface Asset {
  hash: string;
  type: 'png' | 'jpeg' | 'webp';
  bytes: Buffer;
}
interface BackgroundMetadata extends Omit<SavedShareBackground, 'image'> {
  hash: string;
  type: Asset['type'];
}
interface Snapshot {
  version: 1;
  items: BackgroundMetadata[];
  /** Content receipts also prevent another legacy client resurrecting a deleted import. */
  migrated: string[];
}

export class ShareBackgroundError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 409 | 413 | 500 = 400) { super(message); }
}
export function validateBackgroundId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ShareBackgroundError('背景编号无效');
}
function validateName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new ShareBackgroundError('背景名称无效');
}
function validateTimes(item: { createdAt?: unknown; lastUsedAt?: unknown }) {
  for (const value of [item.createdAt, item.lastUsedAt]) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ShareBackgroundError('背景时间无效');
  }
}
async function decodeImage(image: unknown): Promise<Asset> {
  if (typeof image !== 'string' || image.length > MAX_BACKGROUND_BYTES * 4 / 3 + 100) throw new ShareBackgroundError('背景图片超过 2 MB');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) throw new ShareBackgroundError('请选择有效的 PNG、JPEG 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BACKGROUND_BYTES || bytes.toString('base64') !== match[2]) throw new ShareBackgroundError('背景图片内容无效或超过 2 MB');
  try {
    const size = imageSize(bytes);
    const type = size.type === 'jpg' ? 'jpeg' : size.type;
    if (type !== match[1] || size.width < 1 || size.height < 1 || size.width > 2160 || size.height > 2160) throw new Error('invalid image dimensions');
    // Dimensions alone accept truncated headers. Decode actual pixels before committing any replacement.
    const sharp = (await import('sharp')).default;
    await sharp(bytes, { failOn: 'warning', limitInputPixels: 2160 * 2160 }).raw().toBuffer();
  } catch { throw new ShareBackgroundError('背景图片内容无效或分辨率超过 2160 像素'); }
  return { hash: createHash('sha256').update(bytes).digest('hex'), type: match[1] as Asset['type'], bytes };
}

/** All instances and processes coordinate on the same index lock; there is no stale memory cache. */
export class ShareBackgroundStore {
  private readonly directory: string;
  private readonly index: string;
  constructor(dataDir: string) {
    this.directory = join(dataDir, 'share-backgrounds');
    this.index = join(this.directory, 'index.json');
  }
  private async locked<T>(operation: (snapshot: Snapshot) => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const release = await lock(this.index, { realpath: false, stale: 10_000, update: 5_000, retries: { retries: 100, factor: 1.2, minTimeout: 10, maxTimeout: 200 } });
    try { return await operation(await this.read()); }
    finally { await release(); }
  }
  private async read(): Promise<Snapshot> {
    try {
      if ((await stat(this.index)).size > 1024 * 1024) throw new Error('oversized index');
      const snapshot: Snapshot = JSON.parse(await readFile(this.index, 'utf8'));
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.items) || snapshot.items.length > MAX_SHARE_BACKGROUNDS
        || !Array.isArray(snapshot.migrated) || snapshot.migrated.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('invalid index');
      const ids = new Set<string>();
      for (const item of snapshot.items) {
        validateBackgroundId(item?.id); validateName(item.name); validateTimes(item);
        if (ids.has(item.id) || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || !['png', 'jpeg', 'webp'].includes(item.type)) throw new Error('invalid metadata');
        ids.add(item.id);
      }
      // Detect missing/corrupt files before allowing a mutation of the committed snapshot.
      await this.materialize(snapshot.items);
      return snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Only a missing index is an empty library; missing referenced assets are corruption.
        if (await stat(this.index).then(() => false).catch((e: NodeJS.ErrnoException) => e.code === 'ENOENT')) return { version: 1, items: [], migrated: [] };
      }
      throw new ShareBackgroundError('无法读取共享背景图库，原文件已保留，请重试', 500);
    }
  }
  private assetPath(item: Pick<Asset, 'hash' | 'type'>) { return join(this.directory, `${item.hash}.${item.type}`); }
  private async materialize(items: BackgroundMetadata[]): Promise<SavedShareBackground[]> {
    return Promise.all([...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(async (item) => {
      const file = this.assetPath(item);
      if ((await stat(file)).size > MAX_BACKGROUND_BYTES) throw new Error('oversized asset');
      const image = `data:image/${item.type};base64,${(await readFile(file)).toString('base64')}`;
      if ((await decodeImage(image)).hash !== item.hash) throw new Error('corrupt image');
      const { hash: _hash, type: _type, ...metadata } = item;
      return { ...metadata, image };
    }));
  }
  private async commit(snapshot: Snapshot, assets: Asset[] = []): Promise<SavedShareBackground[]> {
    const temporary = `${this.index}.${process.pid}.${randomUUID()}.tmp`;
    const raw = JSON.stringify(snapshot);
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new ShareBackgroundError('背景迁移记录过大，请备份图库后重试', 500);
    try {
      for (const asset of assets) {
        // Content-addressed files are immutable; atomic rename avoids exposing partial bytes after a crash.
        const path = this.assetPath(asset);
        const staged = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(staged, asset.bytes, { flag: 'wx', mode: 0o600 });
          await rename(staged, path);
        } finally { await unlink(staged).catch(() => undefined); }
      }
      await writeFile(temporary, raw, { flag: 'wx', mode: 0o600 });
      // All readers use the lock. Retry Windows scanner/indexer handles without deleting the old index.
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, this.index); break; }
        catch (error) {
          if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (attempt + 1), 250)));
        }
      }
    } catch { throw new ShareBackgroundError('背景保存失败，原图库已保留，请检查存储空间后重试', 500); }
    finally { await unlink(temporary).catch(() => undefined); }
    // After the index commits, orphan cleanup is best effort and cannot turn a successful save into a retry.
    const keep = new Set(snapshot.items.map((item) => `${item.hash}.${item.type}`));
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      if (/^[a-f0-9]{64}\.(png|jpeg|webp)$/.test(name) && !keep.has(name)) await unlink(join(this.directory, name)).catch(() => undefined);
    }
    return this.materialize(snapshot.items);
  }
  list(): Promise<SavedShareBackground[]> { return this.locked((snapshot) => this.materialize(snapshot.items)); }
  async add(input: { name: string; image: string }, replaceId?: string): Promise<SavedShareBackground[]> {
    validateName(input?.name);
    const asset = await decodeImage(input?.image);
    if (replaceId !== undefined) validateBackgroundId(replaceId);
    return this.locked(async (snapshot) => {
      if (replaceId && !snapshot.items.some((item) => item.id === replaceId)) throw new ShareBackgroundError('要替换的背景已不存在，请刷新图库后重试', 409);
      if (!replaceId && snapshot.items.length >= MAX_SHARE_BACKGROUNDS) throw new ShareBackgroundError('共享图库已保存三张背景，请选择要替换的一张', 409);
      const createdAt = Math.max(Date.now(), ...snapshot.items.map((item) => item.createdAt + 1));
      snapshot.items = [...snapshot.items.filter((item) => item.id !== replaceId), { id: randomUUID(), name: input.name, createdAt, lastUsedAt: createdAt, hash: asset.hash, type: asset.type }];
      return this.commit(snapshot, [asset]);
    });
  }
  remove(id: string): Promise<SavedShareBackground[]> {
    validateBackgroundId(id);
    return this.locked((snapshot) => { snapshot.items = snapshot.items.filter((item) => item.id !== id); return this.commit(snapshot); });
  }
  touch(id: string): Promise<SavedShareBackground[]> {
    validateBackgroundId(id);
    return this.locked((snapshot) => {
      snapshot.items = snapshot.items.map((item) => item.id === id ? { ...item, lastUsedAt: Math.max(Date.now(), item.lastUsedAt) } : item);
      return this.commit(snapshot);
    });
  }
  async importLegacy(items: SavedShareBackground[]): Promise<ShareBackgroundImportResult> {
    if (!Array.isArray(items) || items.length > MAX_SHARE_BACKGROUNDS) throw new ShareBackgroundError('旧背景图库格式无效');
    const candidates = (await Promise.all(items.map(async (item) => {
      validateBackgroundId(item?.id); validateName(item.name); validateTimes(item);
      return { item, asset: await decodeImage(item.image) };
    }))).sort((a, b) => b.item.createdAt - a.item.createdAt || b.item.id.localeCompare(a.item.id));
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new ShareBackgroundError('旧背景图库编号重复');
    return this.locked(async (snapshot) => {
      const acceptedIds: string[] = [], pendingIds: string[] = [], assets: Asset[] = [];
      const receipts = new Set(snapshot.migrated);
      let changed = false;
      for (const { item, asset } of candidates) {
        if (receipts.has(asset.hash) || snapshot.items.some((saved) => saved.hash === asset.hash)) {
          if (!receipts.has(asset.hash)) { receipts.add(asset.hash); changed = true; }
          acceptedIds.push(item.id);
        } else if (snapshot.items.length >= MAX_SHARE_BACKGROUNDS) { pendingIds.push(item.id); }
        else {
          snapshot.items.push({ id: randomUUID(), name: item.name, createdAt: item.createdAt, lastUsedAt: item.lastUsedAt, hash: asset.hash, type: asset.type });
          receipts.add(asset.hash); assets.push(asset); acceptedIds.push(item.id); changed = true;
        }
      }
      snapshot.migrated = [...receipts];
      return { items: changed ? await this.commit(snapshot, assets) : await this.materialize(snapshot.items), acceptedIds, pendingIds };
    });
  }
}
