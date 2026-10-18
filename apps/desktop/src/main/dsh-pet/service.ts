import type { ActivityEvent, ModelRef, RpcRequest, RpcResponse } from '../../shared/dsh-pet.js';
import type { QuotaState } from '../../shared/quota.js';
import type { DshPetConfigStore } from './config-store.js';
import type { DshPetAssetStore } from './asset-store.js';
import type { DshPetMemoryStore } from './memory-store.js';
import type { DshPetModelService, ModelMessage } from './model-service.js';
import type { MemeEntry, PetInstance } from './vendor.js';
import { toDshPetBalance } from './balance.js';

interface Options {
  config: DshPetConfigStore; assets: DshPetAssetStore; memory: DshPetMemoryStore; models: DshPetModelService;
  getQuota(): QuotaState | null; quotaSource(): string | null; refreshQuota?(): Promise<void>;
  reload(): Promise<void>; showMainWindow(): void; now?(): number; onChanged?(): void;
  notify?(title: string, body: string): void; isMainWindowVisible?(): boolean;
}
const json = (body: unknown, status = 200): RpcResponse => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const failure = (reason: string, message?: string) => ({ ok: false, reason, ...(message ? { message } : {}) });
const modelRef = (raw: unknown): ModelRef | undefined => { const ref = raw as ModelRef | null; return ref?.provider && ref.model ? ref : undefined; };
const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};

/** Host actions shared by the helper and the independent settings IPC. No HTTP listener. */
export class DshPetService {
  private readonly lifetime = new AbortController();
  private readonly poll;
  private readonly work;
  private readonly conversations = new Map<string, Promise<unknown>>();
  private readonly whispers = new Set<string>();
  private readonly events = new Set<string>();
  private readonly activity = new Map<string, { at: number; expires: number }>();
  private readonly whisperAt = new Map<string, number>();
  private balanceAt = -Infinity;
  private balanceRun: Promise<void> | null = null;
  private seq = 0;
  private workSignature = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly options: Options) {
    this.poll = new options.config.vendor.PollStateStore();
    this.work = new options.config.vendor.WorkStatusStore();
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
    if (method === 'GET' && route === '/state') return json({ ...this.poll.read(), configVersion: this.options.config.version() });
    if (method === 'GET' && /^\/(thumb|pic|font)\//.test(route)) { const asset = await this.options.assets.resolve(rawRoute); return asset ? { status: 200, ...asset } : json(failure('not-found'), 404); }
    if (method === 'POST' && route === '/open-host') { this.options.showMainWindow(); return json({ ok: true }); }
    if (method === 'POST' && route === '/reload') { this.scheduleReload(); return json({ reloading: true }); }
    if (method === 'POST' && route === '/balance') { await this.refreshBalance(true); return json({ ok: true }); }
    if (method === 'POST' && route === '/pet-display') {
      if (typeof body.id !== 'string' || !['web', 'desktop', 'both', 'none'].includes(String(body.display))) return json(failure('bad-request'), 400);
      await this.options.config.setDisplay(body.id, body.display as 'web' | 'desktop' | 'both' | 'none');
      this.scheduleReload(); this.options.onChanged?.(); return json(this.options.config.read());
    }
    const requested = url.searchParams.get('pet') ?? '';
    const active = String(vendor.flattenPetList(cfg)[0]?.id ?? '');
    if (method === 'POST' && route === '/anim') {
      const result = vendor.decideAnim({ cfg, requested, active, name: body.name });
      if (result.ok) this.poll.writePet(result.petId, 'anim', { name: result.name });
      return json(result);
    }
    const id = requested || active, instance = vendor.findPetInstance(cfg, id);
    if (!instance) return json(failure('pet-not-found'), 404);
    if (method === 'GET' && route === '/chat') { const rounds = Number(instance.conf.chatMemoryRounds ?? 5); return json({ ok: true, messages: this.options.memory.get(instance.entry, id, rounds), rounds }); }
    if (method === 'POST' && route === '/broadcast') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) return json(failure('bad-request'), 400);
      const pool = await this.memes(instance);
      const image = typeof body.image === 'string' && pool.some(item => item.name === body.image) ? body.image : undefined;
      this.poll.writePet(id, 'say', { text: body.text.trim(), ...(image ? { image } : {}) }); return json({ ok: true });
    }
    if (method === 'POST' && route === '/whisper') return json(await this.whisper(id, instance, signal));
    if (method === 'POST' && route === '/chat') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) return json(failure('bad-request'), 400);
      return json(await this.chat(id, instance, body.text.trim(), signal));
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
  private prompt(instance: PetInstance): string { return `${String(instance.conf.whisperPrompt ?? '')}\n你的名字是“${String(instance.pet.name ?? instance.pet.id)}”。\n${this.options.config.vendor.timeContextOf(new Date(this.now()))}`; }
  private async chat(id: string, instance: PetInstance, text: string, external?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(50_000);
    const signal = AbortSignal.any([this.lifetime.signal, timeout, ...(external ? [external] : [])]);
    const previous = this.conversations.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      if (signal.aborted) return failure('cancelled');
      const pool = instance.conf.chatImageEnabled ? this.options.config.vendor.limitPool(await this.memes(instance), Number(instance.conf.chatImageLimit ?? 10)) : [];
      const messages: ModelMessage[] = [{ role: 'system', content: `${this.prompt(instance)}${pool.length ? `\n可选表情包：\n${this.options.config.vendor.memeCatalog(pool)}\n合适时在末尾写[图:名称]，最多一张。` : ''}` }, ...this.options.memory.get(instance.entry, id, Number(instance.conf.chatMemoryRounds ?? 5)).map(({ role, content }) => ({ role, content })), { role: 'user', content: text }];
      this.ownActivity(id, 'thinking');
      const result = await this.options.models.generate({ petId: id, kind: 'chat', messages, preferred: modelRef(instance.conf.chatModel), signal });
      if (signal.aborted) { this.ownActivity(id, null); return failure(timeout.aborted ? 'timeout' : 'cancelled'); }
      if (!result.ok) { this.ownActivity(id, 'error'); this.notification('宠物回复失败', result.message ?? result.reason ?? '模型请求失败'); return result; }
      const say = this.options.config.vendor.extractChatImage(result.text!, pool);
      await this.options.memory.append(instance.entry, id, [{ role: 'user', content: text, ts: this.now() }, { role: 'assistant', content: say.text, ts: this.now() }]);
      if (signal.aborted) { this.ownActivity(id, null); return failure('cancelled'); }
      this.poll.writePet(id, 'say', say); this.ownActivity(id, 'success'); this.notification('宠物回复完成', String(instance.pet.name ?? id));
      const { text: _text, ...action } = result; return action;
    });
    this.conversations.set(id, run);
    try { return await run; } finally { if (this.conversations.get(id) === run) this.conversations.delete(id); }
  }
  private async whisper(id: string, instance: PetInstance, external?: AbortSignal): Promise<unknown> {
    if (this.conversations.has(id) || this.whispers.has(id)) return failure('busy');
    this.whispers.add(id);
    const signal = AbortSignal.any([this.lifetime.signal, ...(external ? [external] : [])]);
    try {
      const pool = instance.conf.whisperImageEnabled ? await this.memes(instance) : [];
      const image = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
      const result = await this.options.models.generate({ petId: id, kind: 'whisper', preferred: modelRef(instance.conf.whisperModel), messages: [{ role: 'system', content: this.prompt(instance) }, { role: 'user', content: `随口说一句20字以内的话。${image ? `配合这张表情包：${image.desc}` : ''}` }], signal });
      if (signal.aborted) return failure('cancelled');
      if (result.ok) this.poll.writePet(id, 'say', { text: result.text, ...(image ? { image: image.name } : {}) });
      const { text: _text, ...action } = result; return action;
    } finally { this.whispers.delete(id); }
  }
  private notification(title: string, body: string): void { if (this.options.config.read().main?.notificationsEnabled && !this.options.isMainWindowVisible?.()) this.options.notify?.(title, body); }
  private ownActivity(id: string, state: ActivityEvent['state']): void { this.onActivity({ id: `pet-${++this.seq}`, source: 'pet', sessionId: id, timestamp: new Date(this.now()).toISOString(), state, evidence: 'model-response', terminal: state === 'success' || state === 'error' }); }
  onActivity(event: ActivityEvent): void {
    if (this.lifetime.signal.aborted || this.events.has(event.id)) return;
    const at = Date.parse(event.timestamp), now = this.now(), key = `${event.source}:${event.sessionId}`;
    if (!Number.isFinite(at) || now - at > 120_000 || at > now + 60_000 || at < (this.activity.get(key)?.at ?? 0)) return;
    this.events.add(event.id); if (this.events.size > 10_000) this.events.delete(this.events.values().next().value!);
    if (event.state) { this.work.setState(key, event.state, ++this.seq); this.activity.set(key, { at, expires: now + (event.terminal ? (event.state === 'result' ? 10_000 : 60_000) : 120_000) }); }
    else { this.work.clear(key); this.activity.delete(key); }
    this.publishWork();
    if (event.source !== 'pet' && (event.state === 'waiting' || event.terminal && ['success', 'error'].includes(event.state ?? ''))) this.notification(event.state === 'waiting' ? 'Agent 需要确认' : event.state === 'success' ? 'Agent 本轮完成' : 'Agent 发生错误', `${event.source} · ${event.evidence}`);
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
    for (const [key, entry] of this.activity) if (entry.expires <= now) { this.work.clear(key); this.activity.delete(key); expired = true; }
    if (expired) this.publishWork();
    const cfg = this.options.config.read(), vendor = this.options.config.vendor, pets = vendor.flattenPetList(cfg);
    const seconds = Number(object(cfg.main?.eventsRefreshSec).balance ?? 1800);
    if (pets.some(pet => pet.balanceEnabled) && now - this.balanceAt >= seconds * 1000) { this.balanceAt = now; await this.refreshBalance(false); }
    for (const pet of pets) {
      const id = String(pet.id), instance = vendor.findPetInstance(cfg, id); if (!instance || !pet.whisperEnabled) continue;
      const interval = Number(object(instance.conf.eventsRefreshSec).whisper ?? 300) * 1000;
      if (now - (this.whisperAt.get(id) ?? -Infinity) >= interval && (this.options.models.publicState().defaultModel || modelRef(instance.conf.whisperModel))) { this.whisperAt.set(id, now); void this.whisper(id, instance).catch(() => {}); }
    }
  }
  dispose(): void { this.lifetime.abort(); if (this.timer) clearInterval(this.timer); if (this.reloadTimer) clearTimeout(this.reloadTimer); this.options.models.dispose(); }
}
