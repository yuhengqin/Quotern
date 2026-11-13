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
  resolveNotice?(notice: DesktopNotice): DesktopNotice | null;
  /** Windows close also means a banner timed out; its Action Center entry remains. */
  retainAfterClose?: boolean;
}
export class NotificationManager {
  private disposed = false;
  private readonly active = new Map<string, { notice: DesktopNotice; native: NativeNotice; test: boolean; expiry?: ReturnType<typeof setTimeout>; finish(result: NotificationDelivery): void }>();
  private readonly snoozed = new Map<string, { notice: DesktopNotice; test: boolean; timer: ReturnType<typeof setTimeout> }>();
  private readonly delivered = new Map<string, number>();
  constructor(private readonly options: Options) {}
  private allowed(notice: DesktopNotice, test: boolean): boolean {
    if (this.disposed || !NOTIFICATION_CATEGORIES.includes(notice.category) || notice.expiresAt !== undefined && notice.expiresAt <= Date.now()) return false;
    const mode = this.options.preferences().modes[notice.category];
    return test || mode === 'always' || mode === 'background' && !this.options.isFocused();
  }
  send(notice: DesktopNotice, test = false): Promise<NotificationDelivery> {
    const now = Date.now();
    for (const [id, at] of this.delivered) if (now - at > 120_000) this.delivered.delete(id);
    if (!this.allowed(notice, test) || this.active.has(notice.id) || this.delivered.has(notice.id)) return Promise.resolve('suppressed');
    const scope = notice.replaceKey ?? notice.id, deferred = this.snoozed.get(scope);
    if (deferred && notice.snoozable !== false) { deferred.notice = notice; deferred.test = test; return Promise.resolve('suppressed'); }
    if (deferred) { clearTimeout(deferred.timer); this.snoozed.delete(scope); }
    if (!this.options.isSupported()) { this.options.onIssue('delivery'); return Promise.reject(new Error('NOTIFICATION_UNAVAILABLE')); }
    if (notice.replaceKey) this.dismiss(value => value.replaceKey === notice.replaceKey);
    while (this.active.size >= 64) { const oldest = this.active.values().next().value!; this.dismiss(value => value.id === oldest.notice.id); }
    return new Promise((resolve, reject) => {
      let settled = false, shown = false;
      const timer = setTimeout(() => finish('requested'), 5000); timer.unref?.();
      const finish = (result: NotificationDelivery) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      let native: NativeNotice;
      try { native = this.options.create({ title: Array.from(notice.title).slice(0, 180).join(''), body: Array.from(notice.body.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')).slice(0, 1200).join(''), silent: true }, notice); }
      catch { clearTimeout(timer); this.options.onIssue('delivery'); reject(new Error('NOTIFICATION_FAILED')); return; }
      const record: { notice: DesktopNotice; native: NativeNotice; test: boolean; expiry?: ReturnType<typeof setTimeout>; finish: typeof finish } = { notice, native, test, finish };
      const current = () => !this.disposed && this.active.get(notice.id) === record;
      const failed = () => {
        if (!current()) return;
        this.active.delete(notice.id); this.delivered.delete(notice.id); clearTimeout(timer); clearTimeout(record.expiry);
        this.options.onIssue('delivery');
        if (!settled) { settled = true; reject(new Error('NOTIFICATION_FAILED')); }
      };
      native.on('show', () => {
        if (!current() || shown) return;
        if (!this.allowed(notice, test)) { this.dismiss(value => value.id === notice.id); return; }
        shown = true; this.delivered.set(notice.id, Date.now());
        if (this.delivered.size > 2000) this.delivered.delete(this.delivered.keys().next().value!);
        const sound = this.options.preferences().sound;
        if (sound !== 'none') {
          try { void this.options.sound(sound, current).catch(() => { if (current()) this.options.onIssue('sound'); }); }
          catch { this.options.onIssue('sound'); }
        }
        finish('shown');
      });
      native.on('click', () => { if (current() && !native.handlesActivation) this.activate(notice.id, 'view'); });
      native.on('action', (_event, index: number) => { if (current() && (index === 0 || index === 1)) this.activate(notice.id, index === 0 ? 'view' : 'snooze'); });
      native.on('close', () => {
        if (current()) {
          if (!this.options.retainAfterClose) { this.active.delete(notice.id); clearTimeout(record.expiry); }
          finish('requested');
        }
      });
      native.on('failed', failed);
      this.active.set(notice.id, record);
      if (notice.expiresAt !== undefined) {
        record.expiry = setTimeout(() => this.dismiss(value => value.id === notice.id), Math.max(0, Math.min(2147483647, notice.expiresAt - Date.now())));
        record.expiry.unref?.();
      }
      try { native.show(); } catch { failed(); }
    });
  }
  activate(id: string, action: NotificationAction): boolean {
    const record = this.active.get(id);
    if (!record || !this.allowed(record.notice, record.test)) return false;
    const { notice, test } = record, scope = notice.replaceKey ?? notice.id;
    if (action === 'snooze') {
      if (notice.snoozable === false) return false;
      this.dismiss(value => (value.replaceKey ?? value.id) === scope);
      while (this.snoozed.size >= 64) { const oldest = this.snoozed.values().next().value!; this.dismiss(value => value.id === oldest.notice.id); }
      const deferred = { notice, test, timer: setTimeout(() => {
        this.snoozed.delete(scope);
        let latest: DesktopNotice | null;
        try { latest = this.options.resolveNotice ? this.options.resolveNotice(deferred.notice) : deferred.notice; }
        catch { this.options.onIssue('delivery'); return; }
        if (latest) void this.send(latest, deferred.test).catch(() => { /* Delivery issue is reported by send. */ });
      }, 30 * 60_000) };
      deferred.timer.unref?.(); this.snoozed.set(scope, deferred);
    } else {
      try { this.options.onClick(notice); } catch { this.options.onIssue('delivery'); }
      this.dismiss(value => (value.replaceKey ?? value.id) === scope);
    }
    return true;
  }
  dismiss(predicate: (notice: DesktopNotice) => boolean): void {
    for (const [id, record] of [...this.active]) if (predicate(record.notice)) {
      this.active.delete(id); record.finish('suppressed'); clearTimeout(record.expiry);
      try { record.native.close(); } catch { /* Removed objects must never become live again. */ }
    }
    for (const [scope, record] of this.snoozed) if (predicate(record.notice)) { clearTimeout(record.timer); this.snoozed.delete(scope); }
  }
  reconcile(): void { this.dismiss(notice => !this.allowed(notice, this.active.get(notice.id)?.test ?? this.snoozed.get(notice.replaceKey ?? notice.id)?.test ?? false)); }
  dispose(): void { this.dismiss(() => true); this.disposed = true; this.delivered.clear(); }
}
