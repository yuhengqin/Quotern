import { NOTIFICATION_CATEGORIES, type DesktopNotice, type NotificationAction, type NotificationDelivery, type NotificationPreferences, type NotificationSound } from '../../shared/notifications.js';
export interface NativeNotice {
  on(event: string, listener: (...args: any[]) => void): unknown;
  show(): void; close(): void;
  handlesActivation?: boolean;
}
interface Options {
  preferences(): NotificationPreferences; isFocused(): boolean; isSupported(): boolean;
  create(options: { title: string; body: string; silent: boolean }, notice: DesktopNotice): NativeNotice;
  sound(sound: NotificationSound, current?: () => boolean): Promise<void>; onClick(notice: DesktopNotice): void;
  onIssue(issue: 'delivery' | 'sound'): void;
  onChange?(): void;
  resolveNotice?(notice: DesktopNotice): DesktopNotice | null;
  batch?: { delayMs: number; summarize(notices: DesktopNotice[]): DesktopNotice };
  /** Windows close also means a banner timed out; its Action Center entry remains. */
  retainAfterClose?: boolean;
}
interface Item { notice: DesktopNotice; test: boolean; quiet: boolean; finish?(result: NotificationDelivery): void; fail?(error: unknown): void }
interface Pending extends Item { finish(result: NotificationDelivery): void; fail(error: unknown): void }
interface Active {
  notice: DesktopNotice; items: Item[]; native: NativeNotice; shown: boolean;
  expiry?: ReturnType<typeof setTimeout>; finish(result: NotificationDelivery, settleItems?: boolean): void;
}
const scopeOf = (notice: DesktopNotice) => notice.replaceKey ?? notice.id;
const urgent = (notice: DesktopNotice) => notice.context?.kind === 'quota' && notice.context.alert === 'depleted'
  || notice.context?.kind === 'service' && notice.context.level === 'critical';

export class NotificationManager {
  private disposed = false;
  private readonly active = new Map<string, Active>();
  private readonly pending = new Map<string, Pending>();
  private batchTimer?: ReturnType<typeof setTimeout>;
  private readonly snoozed = new Map<string, { notice: DesktopNotice; test: boolean; timer: ReturnType<typeof setTimeout> }>();
  private readonly delivered = new Map<string, number>();
  constructor(private readonly options: Options) {}
  get count(): number { return [...this.active.values()].reduce((sum, value) => sum + value.items.length, 0) + this.pending.size + this.snoozed.size; }
  private changed(): void { this.options.onChange?.(); }
  private allowed(notice: DesktopNotice, test: boolean): boolean {
    if (this.disposed || !NOTIFICATION_CATEGORIES.includes(notice.category) || notice.expiresAt !== undefined && notice.expiresAt <= Date.now()) return false;
    const mode = this.options.preferences().modes[notice.category];
    return test || mode === 'always' || mode === 'background' && !this.options.isFocused();
  }
  send(notice: DesktopNotice, test = false): Promise<NotificationDelivery> {
    const now = Date.now();
    for (const [id, at] of this.delivered) if (now - at > 120_000) this.delivered.delete(id);
    if (!this.allowed(notice, test) || this.delivered.has(notice.id)
      || [...this.active.values()].some(record => record.items.some(item => item.notice.id === notice.id))
      || [...this.pending.values()].some(item => item.notice.id === notice.id)) return Promise.resolve('suppressed');
    const scope = scopeOf(notice), deferred = this.snoozed.get(scope);
    if (deferred && notice.snoozable !== false) { deferred.notice = notice; deferred.test = test; return Promise.resolve('suppressed'); }
    if (deferred) { clearTimeout(deferred.timer); this.snoozed.delete(scope); }
    if (!this.options.isSupported()) { this.options.onIssue('delivery'); return Promise.reject(new Error('NOTIFICATION_UNAVAILABLE')); }
    if (notice.replaceKey) this.dismiss(value => scopeOf(value) === scope);
    const item = { notice, test, quiet: false };
    if (!this.options.batch || test || !notice.context || urgent(notice)) return this.deliver([item]);
    return new Promise((finish, fail) => this.enqueue({ ...item, finish, fail }));
  }
  private enqueue(item: Pending): void {
    this.pending.set(scopeOf(item.notice), item);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flush(), this.options.batch?.delayMs ?? 0);
      this.batchTimer.unref?.();
    }
    this.changed();
    if (this.pending.size >= 64) this.flush();
  }
  private flush(): void {
    clearTimeout(this.batchTimer); this.batchTimer = undefined;
    const items = [...this.pending.values()]; this.pending.clear();
    const current = items.filter(item => {
      if (this.allowed(item.notice, item.test)) return true;
      item.finish('suppressed'); return false;
    });
    if (current.length) void this.deliver(current).catch(error => { for (const item of current) item.fail(error); });
    this.changed();
  }
  private deliver(items: Item[]): Promise<NotificationDelivery> {
    while (this.active.size >= 64) this.remove(this.active.values().next().value!);
    return new Promise((resolve, reject) => {
      let settled = false, shown = false;
      const timer = setTimeout(() => finish('requested'), 5000); timer.unref?.();
      const finish = (result: NotificationDelivery, settleItems = true) => {
        if (!settled) { settled = true; clearTimeout(timer); if (settleItems) for (const item of items) item.finish?.(result); resolve(result); }
      };
      let notice: DesktopNotice, native: NativeNotice;
      try {
        const content = items.length > 1 ? this.options.batch!.summarize(items.map(item => item.notice)) : items[0]!.notice;
        const actions: NotificationAction[] = ['view'];
        if (items.some(item => item.notice.snoozable !== false)) actions.push('snooze');
        if (this.count + items.length > 1) actions.push('dismiss-all');
        notice = { ...content, actions };
        native = this.options.create({ title: Array.from(notice.title).slice(0, 180).join(''), body: Array.from(notice.body.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')).slice(0, 1200).join(''), silent: true }, notice);
      } catch { clearTimeout(timer); this.options.onIssue('delivery'); reject(new Error('NOTIFICATION_FAILED')); return; }
      const record: Active = { notice, items, native, finish, shown: false };
      const current = () => !this.disposed && this.active.get(notice.id) === record;
      const failed = () => {
        if (!current()) return;
        this.active.delete(notice.id); for (const item of items) this.delivered.delete(item.notice.id);
        clearTimeout(timer); clearTimeout(record.expiry); this.changed();
        this.options.onIssue('delivery');
        if (!settled) { settled = true; reject(new Error('NOTIFICATION_FAILED')); }
      };
      native.on('show', () => {
        if (!current() || shown) return;
        if (items.some(item => !this.allowed(item.notice, item.test))) { this.reconcile(); return; }
        shown = true; record.shown = true;
        for (const item of items) this.delivered.set(item.notice.id, Date.now());
        while (this.delivered.size > 2000) this.delivered.delete(this.delivered.keys().next().value!);
        const sound = this.options.preferences().sound;
        if (sound !== 'none' && items.some(item => !item.quiet)) {
          try { void this.options.sound(sound, current).catch(() => { if (current()) this.options.onIssue('sound'); }); }
          catch { this.options.onIssue('sound'); }
        }
        finish('shown');
      });
      native.on('click', () => { if (current() && !native.handlesActivation) this.activate(notice.id, 'view'); });
      native.on('action', (_event, index: number) => { const action = notice.actions?.[index]; if (current() && action) this.activate(notice.id, action); });
      native.on('close', () => {
        if (current()) {
          if (!this.options.retainAfterClose) { this.active.delete(notice.id); clearTimeout(record.expiry); this.changed(); }
          finish('requested');
        }
      });
      native.on('failed', failed);
      this.active.set(notice.id, record);
      const expiry = Math.min(...items.map(item => item.notice.expiresAt ?? Infinity));
      if (Number.isFinite(expiry)) {
        record.expiry = setTimeout(() => this.dismiss(value => value.expiresAt !== undefined && value.expiresAt <= Date.now()), Math.max(0, Math.min(2147483647, expiry - Date.now())));
        record.expiry.unref?.();
      }
      this.changed();
      try { native.show(); } catch { failed(); }
    });
  }
  activate(id: string, action: NotificationAction): boolean {
    const record = this.active.get(id);
    if (!record || !record.notice.actions?.includes(action)) return false;
    if (record.items.some(item => !this.allowed(item.notice, item.test))) { this.reconcile(); return false; }
    if (action === 'dismiss-all') { this.clear(); return true; }
    const scopes = new Set(record.items.map(item => scopeOf(item.notice)));
    if (action === 'snooze') {
      this.dismiss(value => scopes.has(scopeOf(value)));
      for (const { notice, test } of record.items) {
        if (notice.snoozable === false) continue;
        while (this.snoozed.size >= 64) { const oldest = this.snoozed.values().next().value!; this.dismiss(value => value.id === oldest.notice.id); }
        const scope = scopeOf(notice);
        const deferred = { notice, test, timer: setTimeout(() => {
          this.snoozed.delete(scope); this.changed();
          let latest: DesktopNotice | null;
          try { latest = this.options.resolveNotice ? this.options.resolveNotice(deferred.notice) : deferred.notice; }
          catch { this.options.onIssue('delivery'); return; }
          if (latest) void this.send(latest, deferred.test).catch(() => { /* send reports delivery errors. */ });
        }, 30 * 60_000) };
        deferred.timer.unref?.(); this.snoozed.set(scope, deferred);
      }
      this.changed();
    } else {
      try { this.options.onClick(record.notice); } catch { this.options.onIssue('delivery'); }
      this.dismiss(value => scopes.has(scopeOf(value)));
    }
    return true;
  }
  private remove(record: Active, settleItems = true): void {
    this.active.delete(record.notice.id); record.finish('suppressed', settleItems); clearTimeout(record.expiry);
    try { record.native.close(); } catch { /* Removed objects must never become live again. */ }
  }
  dismiss(predicate: (notice: DesktopNotice) => boolean): void {
    for (const [scope, item] of this.pending) if (predicate(item.notice)) { this.pending.delete(scope); item.finish('suppressed'); }
    for (const [scope, record] of this.snoozed) if (predicate(record.notice)) { clearTimeout(record.timer); this.snoozed.delete(scope); }
    for (const record of [...this.active.values()]) {
      const kept = record.items.filter(item => !predicate(item.notice));
      if (kept.length === record.items.length) continue;
      this.remove(record, kept.length === 0);
      for (const item of record.items) if (!kept.includes(item)) item.finish?.('suppressed');
      for (const item of kept) this.enqueue({ ...item, quiet: item.quiet || record.shown, finish: item.finish ?? (() => {}), fail: item.fail ?? (() => {}) });
    }
    this.changed();
  }
  clear(): void { this.dismiss(() => true); clearTimeout(this.batchTimer); this.batchTimer = undefined; }
  reconcile(): void {
    const tests = new Map<string, boolean>();
    for (const record of this.active.values()) for (const item of record.items) tests.set(item.notice.id, item.test);
    for (const item of this.pending.values()) tests.set(item.notice.id, item.test);
    for (const item of this.snoozed.values()) tests.set(item.notice.id, item.test);
    this.dismiss(notice => !this.allowed(notice, tests.get(notice.id) ?? false));
  }
  dispose(): void { this.disposed = true; this.clear(); this.delivered.clear(); }
}
