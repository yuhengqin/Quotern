import { performance } from 'node:perf_hooks';
import { analyzeQuota, evaluateQuotaAlerts, normalizeQuotaSnapshot, type QuotaAlertKind, type QuotaObservation } from '../shared/quota-analysis.js';
import type { QuotaPreferences, QuotaPreferencePatch, QuotaProviderState, QuotaServiceStatus, QuotaState } from '../shared/quota.js';
import type { SubscriptionChannelId } from '../shared/subscription-channels.js';
import { quotaIdentity } from './quota-identity.js';
import { quotaReadRetryAfter } from './quota-fetch-state.js';
import { validQuotaPatch, pruneQuotaHistory, type QuotaStore } from './quota-store.js';

export interface QuotaReader {
  id: SubscriptionChannelId; label: string; interval: number; read(): Promise<unknown>; statusUrl?: string;
}
export interface QuotaNotification { provider: string; label: string; window: string; kind: QuotaAlertKind; resetsAt: number | null; usedPercent: number }
interface Slot {
  reader: QuotaReader; state: QuotaProviderState; identity: string | null; captured: number;
  observations: Map<string, QuotaObservation>; attempted: number | null; blockedUntil: number; failures: number;
  pending: Promise<void> | null; generation: number;
}
export class QuotaManager {
  private readonly slots: Slot[];
  private readonly now: () => number;
  private readonly mono: () => number;
  private preferences: QuotaPreferences;
  private notice: string | null;
  private lastInteraction: number;
  private locked = false;
  private constrained = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private paused = false;
  private generation = 0;
  private statusAt: number | null = null;
  private statusPending: Promise<void> | null = null;
  private settingsQueue = Promise.resolve();
  private lastMaintenance: number | null = null;
  constructor(private readonly deps: {
    readers: QuotaReader[]; store: QuotaStore; now?: () => number; monotonic?: () => number; timeZone?: string;
    notify(value: QuotaNotification): void; onChanged?(state: QuotaState): void;
    fetchStatus?(url: string): Promise<QuotaServiceStatus['level']>;
  }) {
    this.now = deps.now ?? (() => Date.now() / 1000); this.mono = deps.monotonic ?? (() => performance.now());
    this.preferences = structuredClone(deps.store.preferences); this.notice = deps.store.notice;
    this.lastInteraction = this.mono();
    this.slots = deps.readers.map(reader => ({ reader, state: normalizeQuotaSnapshot(reader.id, reader.label, {}), identity: null, captured: 0,
      observations: new Map(), attempted: null, blockedUntil: 0, failures: 0, pending: null, generation: 0 }));
  }
  private enabled(slot: Slot): boolean { return this.preferences.channels[slot.reader.id] !== false; }
  private interval(slot: Slot): number {
    const idle = (this.mono() - this.lastInteraction) / 1000;
    const multiplier = this.locked || this.constrained ? 10 : idle <= 300 ? 1 : idle <= 3600 ? 2 : idle < 14400 ? 4 : 10;
    return Math.max(slot.reader.interval, Math.min(1800, slot.reader.interval * multiplier));
  }
  getState(): QuotaState {
    const now = this.now();
    return { preferences: structuredClone(this.preferences), notice: this.notice, providers: this.slots.filter(slot => this.enabled(slot)).map(slot => {
      const state = structuredClone(slot.state);
      state.stale ||= state.fetchedAt !== null && state.fetchedAt < now - Math.max(1800, this.interval(slot) * 2);
      state.nextRefreshAt = slot.attempted === null ? null : now + Math.max(0, Math.max(slot.blockedUntil, slot.attempted + this.interval(slot) * 1000) - this.mono()) / 1000;
      if (!state.stale && state.status === 'ready') for (const window of state.windows) {
        if (window.analysisEligible === false) continue;
        const history = slot.identity ? this.deps.store.history[`${slot.reader.id}:${slot.identity}:${window.id}`] ?? [] : [];
        state.analyses[window.id] = analyzeQuota(window, history, now, this.preferences.paceModel, this.deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      }
      return state;
    }) };
  }
  private emit(): void { if (!this.disposed) this.deps.onChanged?.(this.getState()); }
  reportNotice(message: string): void { this.notice = message; this.emit(); }
  setSignals(locked: boolean, constrained: boolean): void { this.locked = locked; this.constrained = constrained; }
  start(): void {
    if (this.disposed) return;
    this.paused = false;
    if (!this.timer) this.timer = setInterval(() => { void this.refresh('periodic'); void this.refreshStatus(); }, 60000);
    this.timer.unref?.();
    void this.refresh('startup'); void this.refreshStatus();
  }
  pause(): void {
    this.paused = true; this.generation++;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = null;
    for (const slot of this.slots) slot.state.refreshing = false;
  }
  resumed(): void {
    if (this.disposed) return;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => { this.wakeTimer = null; void this.refresh('resume'); void this.refreshStatus(); }, 5000);
    this.wakeTimer.unref?.();
  }
  async refresh(reason: 'startup' | 'manual' | 'interaction' | 'periodic' | 'resume', id?: string): Promise<QuotaState> {
    if (this.disposed || this.paused) return this.getState();
    if (reason === 'manual' || reason === 'interaction') this.lastInteraction = this.mono();
    await Promise.all(this.slots.filter(slot => this.enabled(slot) && (!id || slot.reader.id === id)).map(slot => this.refreshSlot(slot, reason)));
    if (!this.disposed && !this.paused && (this.lastMaintenance === null || this.mono() - this.lastMaintenance >= 86400000)) {
      this.lastMaintenance = this.mono();
      if (pruneQuotaHistory(this.deps.store.history, this.now())) {
        try { await this.deps.store.saveHistory(this.deps.store.history); }
        catch { this.notice = '过期额度历史暂未能清理，请检查目录权限。'; }
      }
    }
    this.emit();
    return this.getState();
  }
  private refreshSlot(slot: Slot, reason: string): Promise<void> {
    if (slot.pending) return slot.pending;
    const mono = this.mono();
    if (slot.attempted !== null) {
      if (reason !== 'manual' && mono - slot.attempted < 10000) return Promise.resolve();
      if (reason !== 'manual' && mono < slot.blockedUntil) return Promise.resolve();
      if (reason === 'periodic' && mono - slot.attempted < this.interval(slot) * 1000) return Promise.resolve();
      if (reason === 'interaction' && mono - slot.attempted < Math.min(slot.reader.interval, 60) * 1000) return Promise.resolve();
    }
    slot.attempted = mono;
    slot.state.refreshing = true; this.emit();
    const generation = this.generation, slotGeneration = slot.generation;
    const pending = (async () => {
      let raw: unknown;
      try { raw = await slot.reader.read(); }
      catch { raw = { status: 'temporarily-unavailable', message: '暂时无法读取额度，请稍后重试' }; }
      if (this.disposed || this.paused || generation !== this.generation || slotGeneration !== slot.generation || !this.enabled(slot)) return;
      const normalized = normalizeQuotaSnapshot(slot.reader.id, slot.reader.label, raw);
      normalized.queriedAt = this.now();
      const identity = quotaIdentity(raw);
      if (normalized.stale && !identity) {
        // An old reader may retain data without proving its account. Never promote it
        // into the shared current-account view, notification baseline or history.
        normalized.windows = []; normalized.details = []; normalized.planLabel = null; normalized.fetchedAt = null;
        normalized.status = 'temporarily-unavailable'; normalized.message = '暂时无法确认当前账号额度，请稍后重试';
      }
      const temporary = ['unavailable', 'temporarily-unavailable'].includes(normalized.status) || normalized.stale;
      const metadata = raw as { retryAfterSeconds?: unknown } | null;
      if (temporary) {
        slot.failures++;
        const retry = quotaReadRetryAfter(raw) ?? (typeof metadata?.retryAfterSeconds === 'number' && Number.isFinite(metadata.retryAfterSeconds) ? metadata.retryAfterSeconds : Math.min(1800, 120 * 2 ** Math.min(slot.failures - 1, 4)));
        slot.blockedUntil = Math.max(slot.blockedUntil, this.mono() + Math.max(1, Math.min(3600, retry)) * 1000);
        if (identity && identity === slot.identity && !normalized.windows.length && !normalized.details.length && slot.state.fetchedAt !== null) {
          slot.state = { ...slot.state, queriedAt: normalized.queriedAt, stale: true, message: normalized.message, refreshing: true, analyses: {} };
          return;
        }
      } else { slot.failures = 0; slot.blockedUntil = 0; }
      normalized.service = slot.state.service;
      normalized.refreshing = true;
      slot.state = normalized;
      if (normalized.status !== 'ready') { slot.identity = null; slot.captured = 0; slot.observations.clear(); return; }
      if (normalized.stale) return;
      if (identity !== slot.identity) { slot.identity = identity; slot.captured = 0; slot.observations.clear(); }
      if (!identity || !normalized.fetchedAt || normalized.fetchedAt <= slot.captured) return;
      slot.captured = normalized.fetchedAt;
      const present = new Set<string>();
      for (const window of normalized.windows) {
        if (window.analysisEligible === false) continue;
        present.add(window.id);
        const sample = { at: normalized.fetchedAt, usedPercent: window.usedPercent, resetsAt: window.timeKind === 'expiry' ? null : window.resetsAt };
        const key = `${slot.reader.id}:${identity}:${window.id}`;
        const history = this.deps.store.history[key] ??= [];
        if (!history.length || sample.at > history.at(-1)!.at) history.push(sample);
        const result = evaluateQuotaAlerts(slot.observations.get(window.id) ?? null, sample,
          window.durationSeconds && window.durationSeconds <= 21600 ? 'five-hour' : window.id);
        slot.observations.set(window.id, result.observation);
        // A jump across both thresholds produces one useful message at the higher level.
        const alerts = result.alerts.includes('threshold-90') ? result.alerts.filter(kind => kind !== 'threshold-70') : result.alerts;
        for (const kind of alerts) if (kind === 'reset' ? this.preferences.resetAlerts : this.preferences.thresholdAlerts) {
          try { this.deps.notify({ provider: slot.reader.id, label: slot.reader.label, window: [window.groupLabel, window.label].filter(Boolean).join(' '), kind, resetsAt: sample.resetsAt, usedPercent: window.usedPercent }); }
          catch { this.notice = '系统通知暂不可用，额度卡片仍会继续更新。'; }
        }
      }
      for (const id of slot.observations.keys()) if (!present.has(id)) slot.observations.delete(id);
      pruneQuotaHistory(this.deps.store.history, this.now());
      try { await this.deps.store.saveHistory(this.deps.store.history); }
      catch { this.notice = '额度历史保存失败，当前额度仍可查看。'; }
    })().finally(() => {
      if (slot.pending === pending) slot.pending = null;
      if (!this.disposed && generation === this.generation) { slot.state.refreshing = false; this.emit(); }
    });
    slot.pending = pending;
    return pending;
  }
  setPreferences(patch: QuotaPreferencePatch): Promise<QuotaState> {
    if (!validQuotaPatch(patch)) return Promise.reject(new Error('无效的额度设置'));
    const pending = this.settingsQueue.then(async () => {
      if (this.disposed) throw new Error('额度服务已退出');
      const next = { ...this.preferences, ...patch, channels: { ...this.preferences.channels, ...patch.channels } };
      try { await this.deps.store.savePreferences(next); }
      catch { this.notice = '额度设置保存失败，已保留原设置。'; this.emit(); throw new Error(this.notice); }
      const changedAlerts = next.thresholdAlerts !== this.preferences.thresholdAlerts || next.resetAlerts !== this.preferences.resetAlerts;
      const previous = this.preferences; this.preferences = next;
      for (const slot of this.slots) {
        if (changedAlerts) slot.observations.clear();
        if (previous.channels[slot.reader.id] !== next.channels[slot.reader.id]) {
          slot.generation++; slot.observations.clear();
          if (this.enabled(slot)) slot.attempted = null;
        }
      }
      this.notice = null; this.emit();
      void this.refresh('periodic');
    });
    this.settingsQueue = pending.catch(() => {});
    return pending.then(() => this.getState());
  }
  async refreshStatus(): Promise<void> {
    if (!this.deps.fetchStatus || this.disposed || this.paused) return;
    if (this.statusPending) return this.statusPending;
    if (this.statusAt !== null && this.mono() - this.statusAt < 900000) return;
    this.statusAt = this.mono();
    const generation = this.generation;
    const pending = Promise.all(this.slots.filter(slot => this.enabled(slot) && slot.reader.statusUrl).map(async slot => {
      const slotGeneration = slot.generation;
      let status: QuotaServiceStatus;
      try { status = { level: await this.deps.fetchStatus!(slot.reader.statusUrl!), checkedAt: this.now(), stale: false, url: slot.reader.statusUrl! }; }
      catch { status = slot.state.service ? { ...slot.state.service, stale: true } : { level: 'unknown', checkedAt: null, stale: true, url: slot.reader.statusUrl! }; }
      if (!this.disposed && generation === this.generation && slotGeneration === slot.generation && this.enabled(slot)) slot.state.service = status;
    })).then(() => { if (!this.disposed && generation === this.generation) this.emit(); }).finally(() => { this.statusPending = null; });
    this.statusPending = pending; return pending;
  }
  dispose(): void { this.pause(); this.disposed = true; }
}
