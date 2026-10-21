import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DshPetAction, DshPetState, SessionNavigationTarget } from '../../shared/dsh-pet.js';
import type { QuotaState } from '../../shared/quota.js';
import { DshPetConfigStore } from './config-store.js';
import { DshPetAssetStore } from './asset-store.js';
import { DshPetMemoryStore } from './memory-store.js';
import { DshPetModelService, type SecretStorage } from './model-service.js';
import { DshPetRpcServer } from './rpc.js';
import { DshPetService } from './service.js';
import { DshPetActivityMonitor, type ActivityRoot } from './activity.js';
import { atomicPrivateFile } from './storage.js';

interface Options {
  root: string; runtimeRoot: string; executable: string; appPath: string; packaged: boolean; secrets: SecretStorage;
  getQuota(): QuotaState | null; refreshQuota?(): Promise<void>; showMainWindow(): void; openDirectory(directory: string): Promise<void>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>; isMainWindowVisible?(): boolean; notify?(title: string, body: string, target?: SessionNavigationTarget): void;
  onChanged?(state: DshPetState): void; roots?: ActivityRoot[] | (() => Promise<ActivityRoot[]>); spawn?: (exe: string, args: string[], options: SpawnOptions) => ChildProcess;
}
export class DshPetController {
  readonly config: DshPetConfigStore;
  private models: DshPetModelService;
  private service: DshPetService | null = null;
  private monitor: DshPetActivityMonitor | null = null;
  private pipe: DshPetRpcServer | null = null;
  private child: ChildProcess | null = null;
  private enabled = false;
  private paused = false;
  private disposed = false;
  private status: DshPetState['status'] = 'disabled';
  private error: string | null = null;
  private quotaSource: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: Options) {
    const preferences = path.join(options.root, 'preferences.json');
    const raw = existsSync(preferences) ? JSON.parse(readFileSync(preferences, 'utf8')) as { enabled?: unknown; quotaSource?: unknown; petId?: unknown } : {};
    this.config = new DshPetConfigStore(options.root, options.runtimeRoot, typeof raw.petId === 'string' ? raw.petId : undefined);
    this.models = this.createModels();
    this.enabled = raw.enabled === true; this.quotaSource = typeof raw.quotaSource === 'string' ? raw.quotaSource : null;
  }
  private createModels(): DshPetModelService { return new DshPetModelService(this.options.root, this.options.secrets, { fetch: this.options.fetch }); }
  async initialize(): Promise<void> { if (this.enabled) await this.enqueue(async () => { await this.persist(); await this.start(); }); }
  getState(): DshPetState { return { enabled: this.enabled, status: this.status, error: this.error, config: this.config.read(), models: this.models.publicState(), quotaSource: this.quotaSource, sources: this.monitor?.capabilities() ?? ['codex', 'claude', 'dsh'].map(source => ({ source, states: [], reason: '宠物未运行；尚未监听', lastEventAt: null })) }; }
  private changed(): void { if (!this.disposed) this.options.onChanged?.(this.getState()); }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> { const run = this.queue.then(operation); this.queue = run.catch(() => {}); return run; }
  private persist(): Promise<void> { return atomicPrivateFile(path.join(this.options.root, 'preferences.json'), JSON.stringify({ enabled: this.enabled, quotaSource: this.quotaSource, petId: this.config.petId() })); }
  private async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      const pet = this.config.vendor.flattenPetList(this.config.read())[0];
      if (pet && pet.display !== 'desktop' && pet.display !== 'both') {
        await this.config.setDisplay(String(pet.id), pet.display === 'web' ? 'both' : 'desktop');
        await this.stop();
      }
    }
    this.enabled = enabled; await this.persist();
    if (enabled && !this.paused) await this.start(); else await this.stop();
  }
  dispatch(action: DshPetAction): Promise<unknown> {
    if (!action || typeof action !== 'object' || this.disposed) return Promise.reject(new Error('宠物操作无效'));
    if (action.type === 'read-config') return Promise.resolve(this.config.readText());
    if (action.type === 'request') {
      if (!this.service || typeof action.path !== 'string' || action.path.length > 4096 || !action.path.startsWith('/') || !['GET', 'POST'].includes(action.method) || (action.body !== undefined && typeof action.body !== 'string')) return Promise.reject(new Error('宠物未运行或请求无效'));
      return this.service.handle({ id: 1, method: action.method, url: `/dsh-pet-7340${action.path}`, body: action.body });
    }
    return this.enqueue(async () => {
      switch (action.type) {
        case 'set-enabled':
          if (typeof action.enabled !== 'boolean') throw new Error('开关无效');
          await this.setEnabled(action.enabled); break;
        case 'retry': if (this.enabled && !this.paused) { await this.stop(); await this.start(); } break;
        case 'save-config': await this.config.saveText(action.text); if (this.enabled && !this.paused) { await this.stop(); await this.start(); } break;
        case 'patch-config': if (!action.patch || typeof action.patch !== 'object' || Array.isArray(action.patch)) throw new Error('配置无效'); await this.config.patchMain(action.patch); if (this.enabled && !this.paused) { await this.stop(); await this.start(); } break;
        case 'patch-pet':
          if (typeof action.petId !== 'string' || !action.patch || typeof action.patch !== 'object' || Array.isArray(action.patch) || !this.config.vendor.findPetInstance(this.config.read(), action.petId)) throw new Error('宠物设置无效');
          await this.config.patchPet(action.petId, action.patch); if (this.enabled && !this.paused) { await this.stop(); await this.start(); } break;
        case 'set-desktop-visible': {
          if (typeof action.petId !== 'string' || typeof action.visible !== 'boolean') throw new Error('显示设置无效');
          const found = this.config.vendor.findPetInstance(this.config.read(), action.petId);
          if (!found) throw new Error('没有这只宠物');
          // Read inside the controller queue so rapid toggles preserve the latest web bit.
          const web = found.pet.display === 'web' || found.pet.display === 'both';
          const display = action.visible ? (web ? 'both' : 'desktop') : (web ? 'web' : 'none');
          if (found.pet.display !== display) { await this.config.setDisplay(action.petId, display); await this.stop(); }
          await this.setEnabled(action.visible);
          break;
        }
        case 'reset-config': await this.config.reset(); if (this.enabled && !this.paused) { await this.stop(); await this.start(); } break;
        case 'save-provider': await this.models.setProviders(action.provider); break;
        case 'remove-provider': if (typeof action.id !== 'string') throw new Error('服务商无效'); await this.models.removeProvider(action.id); break;
        case 'set-default-model': await this.models.setDefaultModel(action.model); break;
        case 'set-quota-source': if (action.source !== null && (typeof action.source !== 'string' || action.source.length > 200)) throw new Error('额度来源无效'); this.quotaSource = action.source; await this.persist(); break;
        case 'clear-memory': if (typeof action.petId !== 'string' || !this.config.vendor.findPetInstance(this.config.read(), action.petId)) throw new Error('宠物无效'); await this.stop(); await new DshPetMemoryStore(this.options.root).clear(action.petId); if (this.enabled && !this.paused) await this.start(); break;
        case 'open-directory': await atomicPrivateFile(path.join(this.options.root, '.directory'), 'Quotern dsh-pet'); await this.options.openDirectory(this.options.root); break;
        default: throw new Error('未知宠物操作');
      }
      this.changed(); return this.getState();
    });
  }
  private async start(): Promise<void> {
    if (this.service || this.disposed || this.paused) return;
    this.status = 'starting'; this.error = null; this.changed();
    try {
      const pets = this.config.vendor.flattenPetList(this.config.read()).filter(pet => pet.display === 'desktop' || pet.display === 'both');
      if (!pets.length) { this.enabled = false; await this.persist(); this.status = 'disabled'; this.changed(); return; }
      this.models = this.createModels();
      const service = new DshPetService({ config: this.config, models: this.models, memory: new DshPetMemoryStore(this.options.root), assets: new DshPetAssetStore(this.options.root, this.options.runtimeRoot), getQuota: this.options.getQuota, quotaSource: () => this.quotaSource, refreshQuota: this.options.refreshQuota, reload: () => this.enqueue(async () => { await this.stop(); if (this.enabled && !this.paused) await this.start(); this.changed(); }), showMainWindow: this.options.showMainWindow, isMainWindowVisible: this.options.isMainWindowVisible, notify: this.options.notify, onChanged: () => this.changed() });
      this.service = service;
      const pipe = new DshPetRpcServer(); this.pipe = pipe; const address = await pipe.start((request, signal) => service.handle(request, signal));
      this.monitor = new DshPetActivityMonitor({ roots: this.options.roots ?? [], onEvent: event => service.onActivity(event) });
      await this.monitor.start();
      if (pets.length) {
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (key.startsWith('DSH_PET_')) delete env[key];
        delete env.ELECTRON_RUN_AS_NODE;
        Object.assign(env, { DSH_PET_BRIDGE: '1', DSH_PET_CONFIG_URL: 'http://quotern.invalid/dsh-pet-7340/config', DSH_PET_HOST_PID: String(process.pid), DSH_PET_PETS: JSON.stringify(pets), DSH_PET_PIPE: address.endpoint, DSH_PET_TOKEN: address.token, QUOTERN_DSH_USER_DATA: path.join(this.options.root, 'helper'), QUOTERN_DSH_APP_PATH: this.options.appPath });
        const args = [...(this.options.packaged ? [] : [this.options.appPath]), '--quotern-dsh-pet-helper', '--config-url', 'http://quotern.invalid/dsh-pet-7340/config'];
        const child = (this.options.spawn ?? spawn)(this.options.executable, args, { cwd: path.join(this.options.runtimeRoot, 'runtime'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.child = child;
        child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
        child.once('exit', () => { if (this.child !== child) return; this.child = null; void this.enqueue(async () => { await this.stop(); this.status = 'error'; this.error = '宠物辅助进程已退出，请重试'; this.changed(); }); });
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      }
      service.start(); this.status = 'running'; this.changed();
    } catch { await this.stop(); this.status = 'error'; this.error = '宠物启动失败，请检查配置后重试'; this.changed(); }
  }
  private async stop(): Promise<void> {
    this.monitor?.dispose(); this.monitor = null; const service = this.service; this.service = null; service?.dispose(); await service?.drain();
    const pipe = this.pipe; this.pipe = null; await pipe?.close();
    const child = this.child; this.child = null;
    if (child && child.exitCode == null) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill(); });
    this.status = 'disabled'; this.error = null;
  }
  pause(): Promise<void> { this.paused = true; this.service?.dispose(); return this.enqueue(async () => { await this.stop(); this.changed(); }); }
  resume(): Promise<void> { this.paused = false; return this.enqueue(async () => { if (this.enabled && !this.disposed) await this.start(); }); }
  async dispose(): Promise<void> { this.disposed = true; await this.pause(); }
}
