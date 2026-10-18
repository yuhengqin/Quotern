import { lstat } from 'node:fs/promises';
import path from 'node:path';

export interface AssetResponse { file: string; contentType: string }
const validPart = (part: string): boolean => Boolean(part) && !['.', '..'].includes(part) && !/[\\/:\x00-\x1f?*"<>|]/.test(part);

/** Reject links at every descendant, including pack roots, before returning a file. */
async function checkedFile(base: string, parts: string[]): Promise<string | null> {
  try {
    let file = path.resolve(base);
    if ((await lstat(file)).isSymbolicLink()) return null;
    for (const [i, part] of parts.entries()) {
      if (!validPart(part)) return null;
      file = path.join(file, part);
      const entry = await lstat(file);
      if (entry.isSymbolicLink() || (i < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())) return null;
    }
    return file;
  } catch { return null; }
}

export class DshPetAssetStore {
  constructor(readonly root: string, readonly runtimeRoot: string) {}
  private async exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch { return false; } }
  async memeDirectories(assetRoot: string): Promise<string[]> {
    if (!validPart(assetRoot)) return [];
    const own = path.join(this.root, 'pet', `${assetRoot}-memes`);
    return await this.exists(own) ? [own] : [path.join(this.root, 'memes'), path.join(this.runtimeRoot, 'assets/memes')];
  }
  async resolve(route: string): Promise<AssetResponse | null> {
    let parts: string[];
    try { parts = route.replace(/^\/dsh-pet-7340(?=\/)/, '').split('?')[0]!.split('/').slice(1).map(decodeURIComponent); }
    catch { return null; }
    if (!parts.every(validPart)) return null;
    const [kind, assetRoot, name] = parts;
    if (kind === 'thumb' && parts.length === 3 && /\.(webm|mov)$/.test(name!)) {
      const extension = name!.endsWith('.webm') ? 'webm' : 'mov';
      const roots = assetRoot === 'main'
        ? [{ base: this.root, parts: ['main-animation', extension, name!] }, { base: this.runtimeRoot, parts: ['assets', extension, name!] }]
        : [{ base: this.root, parts: ['pet', `${assetRoot}-animation`, extension, name!] }];
      for (const item of roots) {
        const file = await checkedFile(item.base, item.parts);
        if (file) return { file, contentType: extension === 'webm' ? 'video/webm' : 'video/quicktime' };
      }
    }
    if (kind === 'pic' && assetRoot === 'memes' && parts.length === 4 && parts[3]!.endsWith('.png')) {
      const entry = parts[2]!, filename = parts[3]!;
      const own = path.join(this.root, 'pet', `${entry}-memes`);
      const roots = await this.exists(own)
        ? [{ base: this.root, parts: ['pet', `${entry}-memes`, filename] }]
        : [{ base: this.root, parts: ['memes', filename] }, { base: this.runtimeRoot, parts: ['assets', 'memes', filename] }];
      for (const item of roots) { const file = await checkedFile(item.base, item.parts); if (file) return { file, contentType: 'image/png' }; }
    }
    if (kind === 'pic' && parts.length === 2 && assetRoot!.endsWith('.png')) {
      const file = await checkedFile(this.runtimeRoot, ['assets', 'pic', assetRoot!]);
      if (file) return { file, contentType: 'image/png' };
    }
    if (kind === 'font' && parts.length === 2 && assetRoot!.endsWith('.ttf')) {
      const file = await checkedFile(this.root, ['fonts', assetRoot!]);
      if (file) return { file, contentType: 'font/ttf' };
    }
    return null;
  }
}
