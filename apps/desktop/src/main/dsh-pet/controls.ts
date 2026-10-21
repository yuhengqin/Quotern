import { randomUUID } from 'node:crypto';

// Adapted from PC2005-cloud/dsh-pet cf3ed3c src/host/{playback,lock,motion-cue}.ts (MIT).
// Quotern adds bounded records, cancellation on shutdown and a missing-renderer timeout.
export type PlaybackStatus = 'accepted' | 'playing' | 'ended' | 'failed' | 'cancelled';
export interface PlaybackRecord {
  playbackId: string; petId: string; name: string; status: PlaybackStatus;
  createdAt: number; updatedAt: number; endedAt?: number; reason?: string;
}
type Result = Record<string, unknown> & { ok: boolean };
type Lease = { lockId: string; expiresAt: number; ttl: number };
const terminal = (status: PlaybackStatus) => ['ended', 'failed', 'cancelled'].includes(status);
const bad = (message: string): Result => ({ ok: false, reason: 'bad-request', message });

export class DshPetControls {
  private readonly records = new Map<string, PlaybackRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly locks = new Map<string, Lease>();
  private readonly lost = new Map<string, { lockId: string; cause: string }>();
  constructor(private readonly now: () => number, private readonly write: (pet: string, leaf: string, data: unknown) => void) {}

  sweep(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (!terminal(record.status) && now - record.updatedAt >= 120_000) this.report(id, 'failed', 'renderer-timeout');
      else if (terminal(record.status) && now - record.updatedAt >= 60_000 && !this.listeners.has(id)) this.records.delete(id);
    }
    for (const id of this.locks.keys()) this.lease(id);
  }
  create(petId: string, name: string): PlaybackRecord | null {
    this.sweep();
    if (this.records.size >= 512) {
      const old = [...this.records.values()].find(record => terminal(record.status) && !this.listeners.has(record.playbackId));
      if (!old) return null;
      this.records.delete(old.playbackId);
    }
    this.cancelPet(petId, 'replaced');
    const record: PlaybackRecord = { playbackId: randomUUID(), petId, name, status: 'accepted', createdAt: this.now(), updatedAt: this.now() };
    this.records.set(record.playbackId, record);
    return { ...record };
  }
  get(id: string): PlaybackRecord | undefined { this.sweep(); const record = this.records.get(id); return record && { ...record }; }
  report(id: string, status: PlaybackStatus, reason?: string): PlaybackRecord | undefined {
    const record = this.records.get(id);
    if (!record || terminal(record.status) || record.status === status) return record && { ...record };
    record.status = status; record.updatedAt = this.now();
    if (status === 'ended') record.endedAt = this.now();
    if ((status === 'failed' || status === 'cancelled') && reason) record.reason = reason.slice(0, 200);
    for (const wake of [...(this.listeners.get(id) ?? [])]) wake();
    return { ...record };
  }
  cancelPet(id: string, reason: string): void {
    for (const record of this.records.values()) if (record.petId === id && !terminal(record.status)) this.report(record.playbackId, 'cancelled', reason);
  }
  async query(id: string, params: URLSearchParams, signal?: AbortSignal): Promise<{ status: number; body: Result }> {
    const record = this.get(id);
    if (!record) return { status: 404, body: { ok: false, reason: 'playback-not-found' } };
    const raw = params.get('wait'), timeout = params.get('timeout');
    if (raw === null && timeout === null) return { status: 200, body: { ok: true, ...record } };
    const states = (raw ?? '').split(',').map(value => value.trim());
    if (raw === null || timeout === null || !/^\d+$/.test(timeout) || Number(timeout) > 10_000 || !states.length || states.some(value => !['accepted', 'playing', 'ended', 'failed', 'cancelled'].includes(value))) return { status: 400, body: bad('wait and timeout (0..10000ms) must be supplied together') };
    if (signal?.aborted) return { status: 200, body: { ok: false, reason: 'cancelled' } };
    if (states.includes(record.status) || terminal(record.status)) return { status: 200, body: { ok: true, ...record, matched: states.includes(record.status) } };
    if ([...this.listeners.values()].reduce((sum, items) => sum + items.size, 0) >= 128) return { status: 429, body: { ok: false, reason: 'busy' } };
    return new Promise(resolve => {
      const items = this.listeners.get(id) ?? new Set<() => void>(); this.listeners.set(id, items);
      let settled = false;
      const finish = (cancelled = false) => {
        if (settled) return; settled = true;
        clearTimeout(timer); items.delete(wake); if (!items.size) this.listeners.delete(id);
        signal?.removeEventListener('abort', abort);
        const latest = this.records.get(id);
        resolve({ status: 200, body: cancelled ? { ok: false, reason: 'cancelled' } : latest ? { ok: true, ...latest, matched: states.includes(latest.status) } : { ok: false, reason: 'playback-not-found' } });
      };
      const wake = () => { const status = this.records.get(id)?.status; if (status && (states.includes(status) || terminal(status))) finish(); };
      const abort = () => finish(true);
      const timer = setTimeout(() => finish(), Number(timeout));
      items.add(wake); signal?.addEventListener('abort', abort, { once: true });
    });
  }
  private lease(pet: string): Lease | undefined {
    const lease = this.locks.get(pet);
    if (lease && this.now() >= lease.expiresAt) { this.drop(pet, 'expired'); return undefined; }
    return lease;
  }
  locked(pet: string): boolean { return Boolean(this.lease(pet)); }
  private missing(pet: string, id: string): Result {
    const lost = this.lost.get(pet);
    return { ok: false, reason: 'lock-lost', cause: lost?.lockId === id ? lost.cause : 'unknown' };
  }
  gate(pet: string, id: string | null): Result {
    const lease = this.lease(pet);
    if (id && lease?.lockId !== id) return this.missing(pet, id);
    if (lease && !id) return { ok: false, reason: 'lock-required' };
    return { ok: true };
  }
  acquire(pet: string, body: Record<string, unknown>): Result {
    if (body.lockId !== undefined && typeof body.lockId !== 'string') return bad('invalid lockId');
    const previous = this.lease(pet), id = typeof body.lockId === 'string' ? body.lockId.trim() : '';
    if (id && previous?.lockId !== id) return this.missing(pet, id);
    if (!id && previous) return { ok: false, reason: 'locked', expiresAt: previous.expiresAt };
    const ttl = body.ttl ?? previous?.ttl ?? 120_000;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < 1000 || ttl > 1_800_000) return bad('ttl must be 1000..1800000ms');
    const lease = { lockId: id || randomUUID(), ttl, expiresAt: this.now() + ttl };
    this.locks.set(pet, lease); this.lost.delete(pet);
    if (!id) {
      this.cancelPet(pet, 'locked');
      this.write(pet, 'anim', null);
      this.write(pet, 'position', null); this.write(pet, 'throw', null);
    }
    this.write(pet, 'lock', { locked: true, expiresAt: lease.expiresAt });
    return { ok: true, petId: pet, lockId: lease.lockId, expiresAt: lease.expiresAt, renewed: Boolean(id) };
  }
  release(pet: string, body: Record<string, unknown>): Result {
    const force = body.force === true, id = typeof body.lockId === 'string' ? body.lockId.trim() : '';
    if (force && id || !force && !id) return bad('supply lockId or force:true');
    const lease = this.lease(pet);
    if (!force && lease?.lockId !== id) return this.missing(pet, id);
    if (lease) this.drop(pet, force ? 'preempted' : 'released');
    return { ok: true, petId: pet, released: Boolean(lease) };
  }
  private drop(pet: string, cause: string): void {
    const lease = this.locks.get(pet); if (!lease) return;
    this.locks.delete(pet); this.lost.set(pet, { lockId: lease.lockId, cause });
    this.cancelPet(pet, cause);
    this.write(pet, 'anim', null);
    // Consume outstanding movement before unfreezing; an expired owner must not move the pet later.
    this.write(pet, 'position', null); this.write(pet, 'throw', null);
    this.write(pet, 'lock', { locked: false });
  }
  dispose(): void {
    for (const pet of this.locks.keys()) this.drop(pet, 'released');
    for (const record of this.records.values()) if (!terminal(record.status)) this.report(record.playbackId, 'cancelled', 'stopped');
  }
}

export function motionCue(route: string, body: Record<string, unknown>): Result {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (route === '/throw') return finite(body.angle) && finite(body.power) && body.power > 0 && body.power <= 100
    ? { ok: true, angle: body.angle, power: body.power } : bad('angle must be finite; power must be 0..100');
  if (!finite(body.x) || !finite(body.y) || !['instant', 'spring', 'line'].includes(String(body.mode))) return bad('finite x/y and instant/spring/line mode required');
  if (body.mode === 'line' && (!finite(body.duration) || body.duration < 0 || body.duration > 120_000)) return bad('line duration must be 0..120000ms');
  return { ok: true, x: Math.min(1, Math.max(0, body.x)), y: Math.min(1, Math.max(0, body.y)), mode: body.mode, ...(body.mode === 'line' ? { duration: body.duration } : {}) };
}
