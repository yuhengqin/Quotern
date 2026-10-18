import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { MergedConfig } from '../../shared/dsh-pet.js';
import { parseJsonc } from './jsonc.js';
import { loadVendor, type ConfigPaths, type VendorHost } from './vendor.js';

export class DshPetConfigStore {
  readonly paths: ConfigPaths;
  readonly vendor: VendorHost;
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly root: string, readonly runtimeRoot: string) {
    this.paths = { defaultFile: path.join(runtimeRoot, 'assets/config.jsonc'), userFile: path.join(root, 'main-config.jsonc'), petDir: path.join(root, 'pet') };
    this.vendor = loadVendor(runtimeRoot);
  }
  read(): MergedConfig { return this.vendor.readAllConfig(this.paths); }
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
      if (raw.pets !== undefined && !this.vendor.saveUserConfig({ ...baseline, ...raw }, raw)) throw new Error('配置 pets 或设置字段无效');
      for (const key of ['physics', 'font', 'confineToScreen', 'notificationsEnabled', 'whisperImageEnabled', 'chatImageEnabled', 'whisperModel', 'chatModel', 'eventsRefreshSec', 'animationWeights', 'animations']) {
        if (Object.hasOwn(raw, key) && JSON.stringify(raw[key]) !== JSON.stringify(merged.main?.[key])) throw new Error(`配置 ${key} 无效，未保存`);
      }
      if (raw.pets !== undefined && Array.isArray(raw.pets) && (merged.main?.pets as unknown[])?.length !== raw.pets.length) throw new Error('配置 pets 含重复或无效 ID');
      await rename(staged, this.paths.userFile);
    } finally { await rm(staged, { force: true }); }
  }
  reset(): Promise<void> { return this.saveText(readFileSync(this.paths.defaultFile, 'utf8')); }
  async patchMain(patch: Record<string, unknown>): Promise<void> {
    await this.saveText(JSON.stringify({ ...parseJsonc(this.readText()), ...patch }, null, 2));
  }
}
