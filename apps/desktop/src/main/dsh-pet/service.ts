import type { ActivityEvent, RpcRequest, RpcResponse, SessionNavigationTarget } from '../../shared/dsh-pet.js';
import type { QuotaState } from '../../shared/quota.js';
import type { DshPetConfigStore } from './config-store.js';
import type { DshPetAssetStore } from './asset-store.js';
import type { MemeEntry, PetInstance } from './vendor.js';
import { toDshPetBalance } from './balance.js';
import { DshPetControls, motionCue, type PlaybackStatus } from './controls.js';
import type { DshPetCompanion } from './companion.js';

interface Options {
  config: DshPetConfigStore; assets: DshPetAssetStore;
  getQuota(): QuotaState | null; quotaSource(): string | null; refreshQuota?(): Promise<void>;
  reload(): Promise<void>; showMainWindow(): void; now?(): number; onChanged?(): void;
  notify?(title: string, body: string, target?: SessionNavigationTarget): void; isMainWindowVisible?(): boolean;
  getCompanion?(): DshPetCompanion; sync?(): Promise<void>; openSettings?(): void;
}
const json = (body: unknown, status = 200): RpcResponse => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const failure = (reason: string, message?: string) => ({ ok: false, reason, ...(message ? { message } : {}) });
const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};

/** Host actions shared by the helper and the independent settings IPC. No HTTP listener. */
export class DshPetService {
  private readonly lifetime = new AbortController();
  private readonly poll;
  private readonly work;
  private readonly controls;
  private readonly events = new Set<string>();
  private readonly activity = new Map<string, { at: number; expires: number }>();
  private balanceAt = -Infinity;
  private balanceRun: Promise<void> | null = null;
  private seq = 0;
  private workSignature = '';
  private companionSignature = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly options: Options) {
    this.poll = new options.config.vendor.PollStateStore();
    this.work = new options.config.vendor.WorkStatusStore();
    this.controls = new DshPetControls(() => this.now(), (pet, leaf, data) => this.poll.writePet(pet, leaf, data));
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  start(): void { if (!this.timer && !this.lifetime.signal.aborted) { void this.refreshAutomatic(); this.timer = setInterval(() => { void this.refreshAutomatic().catch(() => {}); }, 1000); this.timer.unref(); } }
  async handle(request: RpcRequest, signal?: AbortSignal): Promise<RpcResponse> {
    if (this.lifetime.signal.aborted) return json(failure('stopped'), 503);
    if (!['GET', 'POST'].includes(request.method) || !request.url.startsWith('/dsh-pet-7340/')) return json(failure('not-found'), 404);
    if (Buffer.byteLength(request.body ?? '') > 1024 * 1024) return json(failure('too-large'), 413);
    const rawRoute = request.url.slice('/dsh-pet-7340'.length);
    let url: URL, body: Record<string, unknown>;
    try { url = new URL(`http://pet${rawRoute}`); body = request.body ? object(JSON.parse(request.body)) : {}; } catch { return json(failure('bad-request'), 400); }
    const method = request.method, route = rawRoute.split('?')[0]!;
    const cfg = this.options.config.read(), vendor = this.options.config.vendor;
    if (method === 'GET' && route === '/config') return json(cfg);
    if (method === 'GET' && route === '/state') { this.controls.sweep(); return json({ ...this.poll.read(), configVersion: this.options.config.version() }); }
    const playback = /^\/playback\/([a-zA-Z0-9-]+)(\/report)?$/.exec(route);
    if (playback) {
      const record = this.controls.get(playback[1]!);
      if (!record) return json(failure('playback-not-found'), 404);
      if (method === 'GET' && !playback[2]) { const result = await this.controls.query(record.playbackId, url.searchParams, signal); return json(result.body, result.status); }
      if (method === 'POST' && playback[2]) {
        if (url.searchParams.get('pet') !== record.petId || !['playing', 'ended', 'failed', 'cancelled'].includes(String(body.status)) || (body.reason !== undefined && typeof body.reason !== 'string')) return json(failure('bad-request'), 400);
        return json({ ok: true, ...this.controls.report(record.playbackId, body.status as PlaybackStatus, body.reason as string | undefined) });
      }
      return json(failure('not-found'), 404);
    }
    if (method === 'GET' && /^\/(thumb|pic|font)\//.test(route)) { const asset = await this.options.assets.resolve(rawRoute); return asset ? { status: 200, ...asset } : json(failure('not-found'), 404); }
    if (method === 'POST' && route === '/open-host') { this.options.showMainWindow(); return json({ ok: true }); }
    if (method === 'POST' && route === '/open-settings') { this.options.openSettings?.(); return json({ ok: Boolean(this.options.openSettings) }); }
    if (method === 'POST' && route === '/sync') {
      try { if (!this.options.sync) return json(failure('unavailable'), 503); await this.options.sync(); await this.refreshAutomatic(); return json({ ok: true }); }
      catch { return json(failure('sync-failed'), 503); }
    }
    if (method === 'POST' && route === '/reload') { this.scheduleReload(); return json({ reloading: true }); }
    if (method === 'POST' && route === '/balance') { await this.refreshBalance(true); return json({ ok: true }); }
    if (method === 'POST' && route === '/pet-display') {
      if (typeof body.id !== 'string' || !['web', 'desktop', 'both', 'none'].includes(String(body.display))) return json(failure('bad-request'), 400);
      if (body.display !== 'desktop' && body.display !== 'both') this.controls.release(body.id, { force: true });
      await this.options.config.setDisplay(body.id, body.display as 'web' | 'desktop' | 'both' | 'none');
      this.scheduleReload(); this.options.onChanged?.(); return json(this.options.config.read());
    }
    const requested = url.searchParams.get('pet') ?? '';
    const active = String(vendor.flattenPetList(cfg)[0]?.id ?? '');
    const id = requested || active, instance = vendor.findPetInstance(cfg, id);
    if (!instance) return json(failure('pet-not-found'), 404);
    if (method === 'POST' && ['/lock', '/position', '/throw'].includes(route) && !requested) return json(failure('pet-required'), 400);
    if (method === 'POST' && route === '/lock/release') return json(this.controls.release(id, body));
    if (method === 'POST' && ['/anim', '/broadcast', '/lock', '/position', '/throw'].includes(route)) {
      if (!['desktop', 'both'].includes(String(instance.pet.display))) return json(failure('pet-not-displayed'));
      const surface = url.searchParams.get('surface');
      if (surface && surface !== 'desktop' && surface !== 'any') return json(failure('surface-unavailable'), 400);
      if (route === '/lock') return json(this.controls.acquire(id, body));
      const gate = this.controls.gate(id, url.searchParams.get('lock'));
      if (!gate.ok) return json(gate);
      if (route === '/position' || route === '/throw') {
        const result = motionCue(route, body);
        if (result.ok) { const { ok: _ok, ...cue } = result; this.poll.writePet(id, route.slice(1), cue); }
        return json({ ...result, petId: id });
      }
    }
    if (method === 'POST' && route === '/anim') {
      const result = vendor.decideAnim({ cfg, requested, active, name: body.name });
      if (body.facing !== undefined && body.facing !== 'left' && body.facing !== 'right') return json(failure('bad-request'), 400);
      if (result.ok) {
        const record = this.controls.create(result.petId, result.name);
        if (!record) return json(failure('busy'), 429);
        this.poll.writePet(result.petId, 'anim', { name: result.name, playbackId: record.playbackId, ...(body.facing ? { facing: body.facing } : {}) });
        return json({ ...result, playbackId: record.playbackId });
      }
      return json(result);
    }
    if (method === 'POST' && route === '/broadcast') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) return json(failure('bad-request'), 400);
      const pool = await this.memes(instance);
      const image = typeof body.image === 'string' && pool.some(item => item.name === body.image) ? body.image : undefined;
      this.poll.writePet(id, 'say', { text: body.text.trim(), ...(image ? { image } : {}) }); return json({ ok: true });
    }
    return json(failure('not-found'), 404);
  }
  private scheduleReload(): void {
    if (this.reloadTimer) return;
    this.reloadTimer = setTimeout(() => { this.reloadTimer = null; if (!this.lifetime.signal.aborted) void this.options.reload().catch(() => {}); }, 20);
  }
  private async memes(instance: PetInstance): Promise<MemeEntry[]> {
    const pool: MemeEntry[] = [];
    for (const [name, desc] of Object.entries(object(instance.conf.memes))) if (typeof desc === 'string' && desc.trim() && await this.options.assets.resolve(`/pic/memes/${encodeURIComponent(instance.entry)}/${encodeURIComponent(name)}.png`)) pool.push({ name, desc });
    return pool;
  }
  private notification(title: string, body: string, target?: SessionNavigationTarget): void { if (this.options.config.read().main?.notificationsEnabled && !this.options.isMainWindowVisible?.()) this.options.notify?.(title, body, target); }
  onActivity(event: ActivityEvent): void {
    if (this.lifetime.signal.aborted || this.events.has(event.id)) return;
    const at = Date.parse(event.timestamp), now = this.now(), key = `${event.source}:${event.sessionId}`;
    if (!Number.isFinite(at) || now - at > 120_000 || at > now + 60_000 || at < (this.activity.get(key)?.at ?? 0)) return;
    this.events.add(event.id); if (this.events.size > 10_000) this.events.delete(this.events.values().next().value!);
    if (event.taskOnly) { this.work.setTask(key, event.task ?? null); }
    else if (event.state) { this.work.setState(key, event.state, ++this.seq); if (event.task !== undefined) this.work.setTask(key, event.task); this.activity.set(key, { at, expires: now + (event.terminal ? (event.state === 'result' ? 10_000 : 60_000) : 120_000) }); }
    else { this.work.clear(key); this.activity.delete(key); }
    this.publishWork();
    if (event.source !== 'pet' && (event.state === 'waiting' || event.terminal && ['success', 'error'].includes(event.state ?? ''))) this.notification(event.state === 'waiting' ? 'Agent 需要确认' : event.state === 'success' ? 'Agent 本轮完成' : 'Agent 发生错误', `${event.source} · ${event.evidence}`, ['codex', 'claude', 'dsh'].includes(event.source) ? { source: event.source as SessionNavigationTarget['source'], sessionId: event.sessionId } : undefined);
    this.options.onChanged?.();
  }
  private publishWork(): void { const { state, task } = this.work.snapshot(); const data = { state, task }, signature = JSON.stringify(data); if (signature !== this.workSignature) { this.workSignature = signature; this.poll.writeSection('workStatus', data); } }
  private async refreshBalance(manual: boolean): Promise<void> {
    if (this.balanceRun) return this.balanceRun;
    const run = (async () => { await this.options.refreshQuota?.().catch(() => {}); if (!this.lifetime.signal.aborted) this.poll.writeSection('balance', { ...toDshPetBalance(this.options.getQuota(), this.options.quotaSource()), ...(manual ? { manual: true } : {}) }); })();
    this.balanceRun = run; try { await run; } finally { this.balanceRun = null; }
  }
  async refreshAutomatic(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    const now = this.now(); let expired = false;
    if (this.options.getCompanion) {
      const data = this.options.getCompanion(), signature = JSON.stringify(data);
      if (signature !== this.companionSignature) { this.companionSignature = signature; this.poll.writeSection('companion', data); }
    }
    for (const [key, entry] of this.activity) if (entry.expires <= now) { this.work.clear(key); this.activity.delete(key); expired = true; }
    if (expired) this.publishWork();
    const cfg = this.options.config.read(), vendor = this.options.config.vendor, pets = vendor.flattenPetList(cfg);
    const seconds = Number(object(cfg.main?.eventsRefreshSec).balance ?? 1800);
    if (pets.some(pet => pet.balanceEnabled) && now - this.balanceAt >= seconds * 1000) { this.balanceAt = now; await this.refreshBalance(false); }
  }
  dispose(): void { this.controls.dispose(); this.lifetime.abort(); if (this.timer) clearInterval(this.timer); if (this.reloadTimer) clearTimeout(this.reloadTimer); }
}
