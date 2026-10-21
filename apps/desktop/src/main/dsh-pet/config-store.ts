import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { MergedConfig } from '../../shared/dsh-pet.js';
import { parseJsonc } from './jsonc.js';
import { loadVendor, type ConfigPaths, type VendorHost } from './vendor.js';
import { atomicPrivateFile } from './storage.js';

export class DshPetConfigStore {
  readonly paths: ConfigPaths;
  readonly vendor: VendorHost;
  private writes: Promise<void> = Promise.resolve();
  private selectedId: string | null;
  constructor(readonly root: string, readonly runtimeRoot: string, preferredPetId?: string) {
    this.selectedId = preferredPetId ?? null;
    this.paths = { defaultFile: path.join(runtimeRoot, 'assets/config.jsonc'), userFile: path.join(root, 'main-config.jsonc'), petDir: path.join(root, 'pet') };
    this.vendor = loadVendor(runtimeRoot);
  }
  readAll(): MergedConfig {
    // The optional user layer does not exist on a normal first launch.
    const paths = existsSync(this.paths.userFile) ? this.paths : { ...this.paths, userFile: this.paths.defaultFile };
    return this.vendor.readAllConfig(paths);
  }
  /** Keep legacy files intact; every runtime consumer receives exactly one pet. */
  read(): MergedConfig {
    const config = this.readAll(), pets = this.vendor.flattenPetList(config);
    const chosen = pets.find(pet => pet.id === this.selectedId)
      ?? pets.find(pet => pet.display === 'desktop' || pet.display === 'both') ?? pets[0];
    this.selectedId = chosen ? String(chosen.id) : null;
    return Object.fromEntries(Object.entries(config).map(([entry, conf]) => [entry, {
      ...conf,
      physics: { ...conf.physics as object, petCollision: false },
      pets: (Array.isArray(conf.pets) ? conf.pets as Record<string, unknown>[] : []).filter(pet => pet.id === this.selectedId),
    }]));
  }
  petId(): string | null { this.read(); return this.selectedId; }
  readText(): string { return readFileSync(existsSync(this.paths.userFile) ? this.paths.userFile : this.paths.defaultFile, 'utf8'); }
  version(): string { return this.vendor.configVersion(this.paths); }

  saveText(text: string): Promise<void> {
    const run = this.writes.then(() => this.save(text));
    this.writes = run.catch(() => {});
    return run;
  }
  private async save(text: string): Promise<void> {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 512 * 1024) throw new Error('配置 JSONC 过大');
    const raw = parseJsonc(text);
    await mkdir(this.root, { recursive: true });
    if (lstatSync(this.root).isSymbolicLink()) throw new Error('配置目录不能是链接');
    if (existsSync(this.paths.userFile) && lstatSync(this.paths.userFile).isSymbolicLink()) throw new Error('配置文件不能是链接');
    const staged = path.join(this.root, `.config-${randomBytes(8).toString('hex')}.jsonc`);
    try {
      await writeFile(staged, text, { flag: 'wx', mode: 0o600 });
      const merged = this.vendor.readAllConfig({ ...this.paths, userFile: staged });
      const baseline = parseJsonc(readFileSync(this.paths.defaultFile, 'utf8'));
      if (!this.vendor.saveUserConfig({ ...baseline, ...raw }, raw)) throw new Error('配置 pets 或设置字段无效');
      for (const key of ['physics', 'font', 'confineToScreen', 'notificationsEnabled', 'whisperImageEnabled', 'chatImageEnabled', 'whisperModel', 'chatModel', 'eventsRefreshSec', 'animationWeights', 'animations', 'chatMemoryRounds', 'chatImageLimit', 'whisperPrompt', 'workStatusTexts']) {
        if (Object.hasOwn(raw, key) && JSON.stringify(raw[key]) !== JSON.stringify(merged.main?.[key])) throw new Error(`配置 ${key} 无效，未保存`);
      }
      if (raw.pets !== undefined && Array.isArray(raw.pets) && (merged.main?.pets as unknown[])?.length !== raw.pets.length) throw new Error('配置 pets 含重复或无效 ID');
      await rename(staged, this.paths.userFile);
    } finally { await rm(staged, { force: true }); }
  }
  async reset(): Promise<void> { await this.saveText(readFileSync(this.paths.defaultFile, 'utf8')); this.selectedId = null; }
  async patchMain(patch: Record<string, unknown>): Promise<void> {
    await this.saveText(JSON.stringify({ ...parseJsonc(this.readText()), ...patch }, null, 2));
  }
  setDisplay(id: string, display: string): Promise<void> {
    if (!['web', 'desktop', 'both', 'none'].includes(display)) return Promise.reject(new Error('display 无效'));
    return this.patchPet(id, { display });
  }
  patchPet(id: string, patch: Record<string, unknown>): Promise<void> {
    const run = this.writes.then(async () => {
      const allowed = new Set(['name', 'size', 'balanceEnabled', 'whisperEnabled', 'workStatusEnabled', 'fixedEnabled', 'display', 'position']);
      if (Object.keys(patch).some(key => !allowed.has(key))) throw new Error('宠物设置字段无效');
      const found = this.vendor.findPetInstance(this.readAll(), id);
      if (!found) throw new Error('没有这只宠物');
      const update = (pet: Record<string, unknown>) => pet.id === id ? { ...pet, ...patch,
        ...(patch.position ? { position: { ...pet.position as object, ...patch.position as object } } : {}),
      } : pet;
      const effective = (found.conf.pets as Record<string, unknown>[]).map(update);
      if (!this.vendor.saveUserConfig({ ...found.conf, pets: effective })) throw new Error('宠物设置无效');
      if (found.entry === 'main') {
        const raw = parseJsonc(this.readText());
        const pets = (Array.isArray(raw.pets) ? raw.pets : found.conf.pets) as Record<string, unknown>[];
        await this.save(JSON.stringify({ ...raw, pets: pets.map(update) }, null, 2));
      } else {
        if (path.basename(found.entry) !== found.entry || /[\\/:]/.test(found.entry)) throw new Error('宠物包目录无效');
        if (lstatSync(this.paths.petDir).isSymbolicLink()) throw new Error('宠物包目录不能是链接');
        const entry = this.vendor.readPetConfigEntry(this.paths, found.entry);
        if (!entry?.raw || lstatSync(entry.path).isSymbolicLink()) throw new Error('宠物包配置无效');
        const file = entry.path, raw = entry.raw;
        const pets = (raw.pets as Record<string, unknown>[]).map(update);
        await atomicPrivateFile(file, JSON.stringify({ ...raw, pets }, null, 2));
      }
    });
    this.writes = run.catch(() => {});
    return run;
  }
}
