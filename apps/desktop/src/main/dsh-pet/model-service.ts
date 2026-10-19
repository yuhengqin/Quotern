import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ModelRef, ModelResult, ModelSettings, ProviderPatch } from '../../shared/dsh-pet.js';
import { atomicPrivateFile } from './storage.js';

export interface SecretStorage { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
interface StoredProvider extends Omit<ProviderPatch, 'apiKey'> { encryptedKey?: string }
interface GenerateRequest { petId: string; kind: 'chat' | 'whisper'; messages: ModelMessage[]; preferred?: ModelRef; signal?: AbortSignal }
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
const cancelled = (): ModelResult => ({ ok: false, reason: 'cancelled', fallback: false });

export class DshPetModelService {
  private providers = new Map<string, StoredProvider>();
  private defaultModel: ModelRef | null = null;
  private readonly lifetime = new AbortController();
  private readonly queues = new Map<string, Promise<ModelResult>>();
  private settingsQueue: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(root: string, private readonly secrets: SecretStorage, private readonly options: { timeoutMs?: number; fetch?: (url: string, init: RequestInit) => Promise<Response> } = {}) {
    this.file = path.join(root, 'models.json');
    if (!existsSync(this.file)) return;
    if (lstatSync(this.file).isSymbolicLink()) throw new Error('模型配置不能是链接');
    const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { providers?: StoredProvider[]; defaultModel?: ModelRef };
    if (!Array.isArray(raw.providers)) throw new Error('模型配置损坏');
    for (const provider of raw.providers) {
      this.validateProvider(provider);
      this.providers.set(provider.id, { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, models: [...provider.models], ...(typeof provider.encryptedKey === 'string' ? { encryptedKey: provider.encryptedKey } : {}) });
    }
    if (raw.defaultModel && this.hasModel(raw.defaultModel)) this.defaultModel = { ...raw.defaultModel };
  }
  publicState(): ModelSettings {
    return { providers: [...this.providers.values()].map(({ encryptedKey, ...provider }) => ({ ...provider, models: [...provider.models], apiKeyConfigured: Boolean(encryptedKey) })), defaultModel: this.defaultModel && { ...this.defaultModel } };
  }
  setProviders(patch: ProviderPatch): Promise<void> {
    return this.update(async () => {
      this.validateProvider(patch);
      const previous = this.providers.get(patch.id);
      let encryptedKey = previous?.encryptedKey;
      if (patch.apiKey !== undefined) {
        if (typeof patch.apiKey !== 'string' || patch.apiKey.length > 16_384) throw new Error('API key 无效');
        if (patch.apiKey && !this.secrets.isEncryptionAvailable()) throw new Error('系统加密不可用，未保存 API key');
        encryptedKey = patch.apiKey ? this.secrets.encryptString(patch.apiKey).toString('base64') : undefined;
      }
      const providers = new Map(this.providers);
      providers.set(patch.id, { id: patch.id, name: patch.name.trim(), baseUrl: patch.baseUrl.replace(/\/+$/, ''), models: [...new Set(patch.models.map(value => value.trim()))], ...(encryptedKey ? { encryptedKey } : {}) });
      await this.persist(providers, this.defaultModel);
    });
  }
  removeProvider(id: string): Promise<void> { return this.update(async () => { const providers = new Map(this.providers); providers.delete(id); await this.persist(providers, this.defaultModel?.provider === id ? null : this.defaultModel); }); }
  setDefaultModel(model: ModelRef | null): Promise<void> {
    return this.update(async () => { if (model && !this.hasModel(model)) throw new Error('默认模型未配置'); await this.persist(this.providers, model && { ...model }); });
  }
  private update(write: () => Promise<void>): Promise<void> { const run = this.settingsQueue.then(write); this.settingsQueue = run.catch(() => {}); return run; }
  private async persist(providers: Map<string, StoredProvider>, defaultModel: ModelRef | null): Promise<void> {
    await atomicPrivateFile(this.file, JSON.stringify({ providers: [...providers.values()], defaultModel }));
    this.providers = providers; this.defaultModel = defaultModel;
  }
  private hasModel(model: ModelRef): boolean {
    const provider = this.providers.get(model.provider);
    return Boolean(provider && typeof model.model === 'string' && model.model.trim() && (!provider.models.length || provider.models.includes(model.model)));
  }
  private validateProvider(provider: Omit<ProviderPatch, 'apiKey'>): void {
    if (!provider || !validId(provider.id) || typeof provider.name !== 'string' || !provider.name.trim() || provider.name.length > 100 || !Array.isArray(provider.models) || provider.models.length > 100 || provider.models.some(model => typeof model !== 'string' || !model.trim() || model.length > 200)) throw new Error('服务商配置无效');
    let url: URL; try { url = new URL(provider.baseUrl); } catch { throw new Error('Base URL 无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 必须是 HTTP(S) 地址，不包含凭证或查询参数');
  }
  generate(request: GenerateRequest): Promise<ModelResult> {
    if (this.lifetime.signal.aborted || request.signal?.aborted) return Promise.resolve(cancelled());
    if (request.kind === 'whisper' && this.queues.has(request.petId)) return Promise.resolve({ ok: false, reason: 'busy', fallback: false });
    const deadline = new AbortController();
    const timeout = setTimeout(() => deadline.abort(), this.options.timeoutMs ?? 50_000); timeout.unref();
    const signal = AbortSignal.any([this.lifetime.signal, deadline.signal, ...(request.signal ? [request.signal] : [])]);
    const previous = this.queues.get(request.petId) ?? Promise.resolve({ ok: true, fallback: false });
    const run = previous.catch(() => cancelled()).then(() => this.perform(request, signal, deadline.signal));
    this.queues.set(request.petId, run);
    void run.then(() => { clearTimeout(timeout); if (this.queues.get(request.petId) === run) this.queues.delete(request.petId); });
    return run;
  }
  private async perform(request: GenerateRequest, signal: AbortSignal, deadline: AbortSignal): Promise<ModelResult> {
    const candidates = [request.preferred, this.defaultModel ?? undefined].filter((item): item is ModelRef => Boolean(item?.provider && item.model));
    const unique = candidates.filter((item, index) => candidates.findIndex(other => item.provider === other.provider && item.model === other.model) === index);
    if (!unique.length) return { ok: false, reason: 'provider-missing', message: '未配置宠物模型', fallback: false };
    if (!Array.isArray(request.messages) || request.messages.some(item => !item || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string') || Buffer.byteLength(JSON.stringify(request.messages)) > 512 * 1024) return { ok: false, reason: 'bad-request', fallback: false };
    let last: ModelResult = { ok: false, reason: 'generate-error', fallback: false };
    for (const [index, selection] of unique.entries()) {
      if (signal.aborted) return this.abortResult(deadline);
      const provider = this.providers.get(selection.provider);
      try {
        if (!provider || !this.hasModel(selection)) throw new Error('所选模型未配置');
        if (provider.encryptedKey && !this.secrets.isEncryptionAvailable()) throw new Error('系统加密不可用');
        const key = provider.encryptedKey ? this.secrets.decryptString(Buffer.from(provider.encryptedKey, 'base64')) : '';
        const url = provider.baseUrl.endsWith('/chat/completions') ? provider.baseUrl : `${provider.baseUrl}/chat/completions`;
        const response = await (this.options.fetch ?? fetch)(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: selection.model, messages: request.messages, stream: false }), redirect: 'error', signal });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`模型请求失败 (HTTP ${response.status})`); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('模型未返回正文');
        const chunks: Uint8Array[] = []; let bytes = 0;
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 1024 * 1024) throw new Error('模型响应过大'); chunks.push(chunk.value); } }
        finally { await reader.cancel().catch(() => {}); }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
        const choice = payload.choices?.[0];
        if (choice?.finish_reason === 'length') return { ok: false, reason: 'truncated', message: '模型输出已截断', ...selection, provider: selection.provider, fallback: index > 0 };
        const content = choice?.message?.content;
        const text = typeof content === 'string' ? content.trim() : Array.isArray(content) ? content.map(part => part?.type === 'text' && typeof part.text === 'string' ? part.text : '').join('').trim() : '';
        if (!text) throw new Error('模型未返回文本');
        if (signal.aborted) return this.abortResult(deadline);
        return { ok: true, text, ...selection, fallback: index > 0 };
      } catch (error) {
        if (signal.aborted) return this.abortResult(deadline);
        // No response body, credential, prompt or provider-generated error text enters state/logs.
        last = { ok: false, reason: 'generate-error', message: error instanceof Error && /^模型|^所选|^系统/.test(error.message) ? error.message : '模型请求失败', ...selection, fallback: index > 0 };
      }
    }
    return last;
  }
  private abortResult(deadline: AbortSignal): ModelResult { return this.lifetime.signal.aborted || !deadline.aborted ? cancelled() : { ok: false, reason: 'timeout', message: '模型请求超时', fallback: false }; }
  dispose(): void { this.lifetime.abort(); }
}
