import { app, protocol } from 'electron';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import yauzl from 'yauzl';
import { BUILTIN_PETS, PET_ID_RE, type PetCatalogEntry } from './pet-core';

const MAX_PACKAGE = 12 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024;
const MAX_ATLAS = 10 * 1024 * 1024;
const BUILTIN_IDS: Set<string> = new Set(BUILTIN_PETS.map(pet => pet.id));

export const PET_ASSET_SCHEME = 'quotern-pet';

function bundledAsset(pathname: string): { file: string; contentType: string } | null {
  const root = app.isPackaged
    ? path.join(app.getAppPath(), 'out', 'renderer')
    : path.join(app.getAppPath(), 'src', 'renderer', 'public');
  const clawd = /^\/clawd\/((?:[a-z0-9-]+\/)*[a-z0-9-]+\.svg)$/.exec(pathname);
  if (clawd) return { file: path.join(root, 'clawd', clawd[1]!), contentType: 'image/svg+xml' };
  return null;
}

/** Must be called before app.ready. Only catalog-validated local assets are exposed. */
export function registerPetAssetScheme(additionalSchemes: Electron.CustomScheme[] = []): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: PET_ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }, ...additionalSchemes]);
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

export function readWebpDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('spritesheet.webp 不是有效的 WebP 文件');
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('spritesheet.webp 文件长度无效');
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) throw new Error('spritesheet.webp 不完整');
    if (type === 'VP8X' && size >= 10) return { width: readUInt24LE(buffer, data + 4) + 1, height: readUInt24LE(buffer, data + 7) + 1 };
    if (type === 'VP8 ' && size >= 10) {
      if (buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) throw new Error('spritesheet.webp 帧头无效');
      return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff };
    }
    if (type === 'VP8L' && size >= 5) {
      if (buffer[data] !== 0x2f) throw new Error('spritesheet.webp 帧头无效');
      const bits = buffer.readUInt32LE(data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = data + size + size % 2;
  }
  throw new Error('spritesheet.webp 没有可读取的图像帧');
}

export interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: 'spritesheet.webp';
  spriteVersionNumber: 1 | 2;
  kind?: string;
}

export function petIdFromCodexPetsUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (PET_ID_RE.test(trimmed)) return trimmed;
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error('请输入 codex-pets.net 宠物地址或 ID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'codex-pets.net') throw new Error('仅支持 codex-pets.net 的 HTTPS 宠物地址');
  const id = url.hash.match(/^#\/pets\/([a-z0-9-]+)\/?$/i)?.[1]
    ?? url.pathname.match(/^\/api\/pets\/([a-z0-9-]+)(?:\/download)?\/?$/i)?.[1];
  const normalized = id?.toLowerCase() ?? '';
  if (!PET_ID_RE.test(normalized)) throw new Error('宠物地址中没有有效的角色 ID');
  return normalized;
}

export function validatePetPackage(manifestBuffer: Buffer, atlas: Buffer): PetManifest {
  if (manifestBuffer.length === 0 || manifestBuffer.length > MAX_MANIFEST) throw new Error('pet.json 缺失或过大');
  if (atlas.length === 0 || atlas.length > MAX_ATLAS) throw new Error('spritesheet.webp 缺失或过大');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(manifestBuffer.toString('utf8')) as Record<string, unknown>; }
  catch { throw new Error('pet.json 不是有效的 JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('pet.json 必须是对象');
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
  const spriteVersionNumber = raw.spriteVersionNumber === undefined ? 1 : raw.spriteVersionNumber;
  if (!PET_ID_RE.test(id) || BUILTIN_IDS.has(id)) throw new Error('pet.json 的 id 无效或与内置角色重复');
  if (!displayName || displayName.length > 80 || !description || description.length > 280) throw new Error('pet.json 的名称或描述无效');
  if (raw.spritesheetPath !== 'spritesheet.webp') throw new Error('pet.json 的 spritesheetPath 必须是 spritesheet.webp');
  if (spriteVersionNumber !== 1 && spriteVersionNumber !== 2) throw new Error('不支持的宠物图集版本');
  if (kind && !/^[a-z][a-z0-9-]{0,39}$/.test(kind)) throw new Error('pet.json 的 kind 无效');
  const dimensions = readWebpDimensions(atlas);
  const height = spriteVersionNumber === 2 ? 2288 : 1872;
  if (dimensions.width !== 1536 || dimensions.height !== height) throw new Error(`宠物图集必须是 1536×${height}`);
  return { id, displayName, description, spritesheetPath: 'spritesheet.webp', spriteVersionNumber, ...(kind ? { kind } : {}) };
}

async function readZip(buffer: Buffer): Promise<{ manifest: Buffer; atlas: Buffer }> {
  if (!buffer.length || buffer.length > MAX_PACKAGE) throw new Error('宠物 ZIP 不能为空且不能超过 12 MB');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) { reject(new Error(`无法打开宠物 ZIP：${openError?.message ?? '未知错误'}`)); return; }
      const entries = new Map<string, Buffer>();
      let done = false;
      const fail = (message: string) => {
        if (done) return;
        done = true;
        zip.close();
        reject(new Error(message));
      };
      zip.on('error', error => fail(`宠物 ZIP 读取失败：${error.message}`));
      zip.on('entry', entry => {
        const name = entry.fileName;
        if (name !== 'pet.json' && name !== 'spritesheet.webp') { fail('ZIP 根目录只能包含 pet.json 和 spritesheet.webp'); return; }
        if (entries.has(name)) { fail(`ZIP 中有重复的 ${name}`); return; }
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) { fail('ZIP 不能包含符号链接'); return; }
        const limit = name === 'pet.json' ? MAX_MANIFEST : MAX_ATLAS;
        if (entry.uncompressedSize <= 0 || entry.uncompressedSize > limit) { fail(`${name} 缺失或过大`); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(`无法读取 ${name}`); return; }
          const chunks: Buffer[] = [];
          let total = 0;
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > limit) { stream.destroy(new Error(`${name} 过大`)); return; }
            chunks.push(chunk);
          });
          stream.on('error', error => fail(error.message));
          stream.on('end', () => {
            if (done) return;
            entries.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (done) return;
        done = true;
        const manifest = entries.get('pet.json');
        const atlas = entries.get('spritesheet.webp');
        if (!manifest || !atlas || entries.size !== 2) reject(new Error('ZIP 必须包含 pet.json 和 spritesheet.webp'));
        else resolve({ manifest, atlas });
      });
      zip.readEntry();
    });
  });
}

export class PetCatalog {
  private readonly root: string;
  private readonly hiddenPath: string;
  private readonly codexRoot: string;

  constructor(root?: string, codexRoot?: string) {
    this.root = root ?? path.join(app.getPath('userData'), 'pets');
    this.hiddenPath = path.join(this.root, '.hidden-builtins.json');
    this.codexRoot = codexRoot ?? path.join(homedir(), '.codex', 'pets');
  }

  private petPath(id: string): string {
    if (!PET_ID_RE.test(id) || BUILTIN_IDS.has(id)) throw new Error('无效的自定义宠物 ID');
    const target = path.resolve(this.root, id);
    if (path.dirname(target) !== path.resolve(this.root)) throw new Error('无效的宠物目录');
    return target;
  }

  private async checkedPetDirectory(dir: string): Promise<string> {
    const directory = await lstat(dir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('宠物目录无效');
    for (const name of ['pet.json', 'spritesheet.webp']) {
      const entry = await lstat(path.join(dir, name));
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('宠物文件无效');
    }
    return dir;
  }

  private async safeInstalledPath(id: string): Promise<string> {
    return this.checkedPetDirectory(this.petPath(id));
  }

  private async safeCodexPath(id: string): Promise<string> {
    if (!PET_ID_RE.test(id)) throw new Error('无效的 Codex 宠物 ID');
    const dir = path.resolve(this.codexRoot, id);
    if (path.dirname(dir) !== path.resolve(this.codexRoot)) throw new Error('无效的 Codex 宠物目录');
    return this.checkedPetDirectory(dir);
  }

  async list(): Promise<PetCatalogEntry[]> {
    const builtins = BUILTIN_PETS.map(pet => ({ ...pet }));
    let entries: string[];
    try { entries = await readdir(this.root); } catch { return builtins; }
    const customs = await Promise.all(entries.filter(id => PET_ID_RE.test(id) && !BUILTIN_IDS.has(id)).map(async id => {
      try {
        const dir = await this.safeInstalledPath(id);
        const [manifestBuffer, atlas] = await Promise.all([readFile(path.join(dir, 'pet.json')), readFile(path.join(dir, 'spritesheet.webp'))]);
        const manifest = validatePetPackage(manifestBuffer, atlas);
        if (manifest.id !== id) return null;
        return { ...manifest, custom: true, assetUrl: `${PET_ASSET_SCHEME}://asset/${id}/spritesheet.webp` } satisfies PetCatalogEntry;
      } catch { return null; }
    }));
    return [...builtins, ...customs.filter((pet): pet is NonNullable<typeof pet> => pet !== null)];
  }

  async installBuffers(manifestBuffer: Buffer, atlas: Buffer): Promise<PetCatalogEntry> {
    const manifest = validatePetPackage(manifestBuffer, atlas);
    await mkdir(this.root, { recursive: true });
    const target = this.petPath(manifest.id);
    try { await stat(target); throw new Error('该宠物已导入'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const stage = path.join(this.root, `.stage-${randomBytes(8).toString('hex')}`);
    await mkdir(stage);
    try {
      await Promise.all([
        writeFile(path.join(stage, 'pet.json'), `${JSON.stringify(manifest, null, 2)}\n`),
        writeFile(path.join(stage, 'spritesheet.webp'), atlas),
      ]);
      await rename(stage, target);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
    return { ...manifest, custom: true, assetUrl: `${PET_ASSET_SCHEME}://asset/${manifest.id}/spritesheet.webp` };
  }

  async installZip(buffer: Buffer): Promise<PetCatalogEntry> {
    const files = await readZip(buffer);
    return this.installBuffers(files.manifest, files.atlas);
  }

  async remove(id: string): Promise<void> {
    const target = await this.safeInstalledPath(id);
    const files = await readdir(target);
    if (files.some(name => name !== 'pet.json' && name !== 'spritesheet.webp')) {
      throw new Error('宠物目录包含其他文件，已保留原目录');
    }
    // Only catalog-owned fixed files are removed; no recursive walk into external data.
    await rm(path.join(target, 'pet.json'), { force: true });
    await rm(path.join(target, 'spritesheet.webp'), { force: true });
    await rmdir(target);
  }

  async restoreBuiltins(): Promise<void> {
    await rm(this.hiddenPath, { force: true });
  }

  async listCodex(): Promise<PetCatalogEntry[]> {
    let ids: string[];
    try { ids = await readdir(this.codexRoot); } catch { return []; }
    const installed = new Set((await this.list()).map(pet => pet.id));
    const candidates = await Promise.all(ids.filter(id => PET_ID_RE.test(id) && !installed.has(id)).map(async id => {
      try {
        const dir = await this.safeCodexPath(id);
        const [manifestBuffer, atlas] = await Promise.all([readFile(path.join(dir, 'pet.json')), readFile(path.join(dir, 'spritesheet.webp'))]);
        const manifest = validatePetPackage(manifestBuffer, atlas);
        return manifest.id === id
          ? { ...manifest, custom: true, assetUrl: `${PET_ASSET_SCHEME}://codex/${id}/spritesheet.webp` }
          : null;
      } catch { return null; }
    }));
    return candidates.filter((pet): pet is NonNullable<typeof pet> => pet !== null);
  }

  async importCodex(ids: string[]): Promise<PetCatalogEntry[]> {
    if (!Array.isArray(ids) || ids.length > 30 || ids.some(id => !PET_ID_RE.test(id))) throw new Error('无效的宠物列表');
    const allowed = new Set((await this.listCodex()).map(pet => pet.id));
    if (ids.some(id => !allowed.has(id))) throw new Error('所选 Codex 宠物不可导入');
    const results: PetCatalogEntry[] = [];
    for (const id of ids) {
      const dir = await this.safeCodexPath(id);
      const [manifest, atlas] = await Promise.all([readFile(path.join(dir, 'pet.json')), readFile(path.join(dir, 'spritesheet.webp'))]);
      results.push(await this.installBuffers(manifest, atlas));
    }
    return results;
  }

  async installFromUrl(input: string): Promise<PetCatalogEntry> {
    const id = petIdFromCodexPetsUrl(input);
    const response = await fetch(`https://codex-pets.net/api/pets/${encodeURIComponent(id)}/download`, {
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
      headers: { accept: 'application/zip', 'user-agent': 'Quotern Pet Importer' },
    });
    if (!response.ok || !response.body) throw new Error(`下载宠物包失败（${response.status}）`);
    if (Number(response.headers.get('content-length') || 0) > MAX_PACKAGE) throw new Error('宠物包超过 12 MB');
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_PACKAGE) throw new Error('宠物包超过 12 MB');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    return this.installZip(Buffer.concat(chunks));
  }

  registerAssetProtocol(): void {
    protocol.handle(PET_ASSET_SCHEME, async request => {
      const url = new URL(request.url);
      if (url.hostname === 'builtin') {
        const asset = bundledAsset(url.pathname);
        if (!asset) return new Response(null, { status: 404 });
        try {
          const body = await readFile(asset.file);
          return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Type': asset.contentType, 'Access-Control-Allow-Origin': '*' } });
        } catch { return new Response(null, { status: 404 }); }
      }
      const match = /^\/([a-z0-9-]+)\/spritesheet\.webp$/.exec(url.pathname);
      if (!match || !PET_ID_RE.test(match[1]!) || (url.hostname !== 'asset' && url.hostname !== 'codex')) return new Response(null, { status: 404 });
      try {
        const dir = url.hostname === 'codex' ? await this.safeCodexPath(match[1]!) : await this.safeInstalledPath(match[1]!);
        const file = path.join(dir, 'spritesheet.webp');
        const body = await readFile(file);
        return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Type': 'image/webp', 'Access-Control-Allow-Origin': '*' } });
      } catch { return new Response(null, { status: 404 }); }
    });
  }

  unregisterAssetProtocol(): void {
    protocol.unhandle(PET_ASSET_SCHEME);
  }
}
