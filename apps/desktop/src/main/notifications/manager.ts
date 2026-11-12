import type { DesktopNotice, NotificationDelivery, NotificationPreferences, NotificationSound } from '../../shared/notifications.js';
export interface NativeNotice {
  on(event: string, listener: (...args: any[]) => void): unknown;
  show(): void; close(): void;
}
interface Options {
  preferences(): NotificationPreferences; isFocused(): boolean; isSupported(): boolean;
  create(options: { title: string; body: string; silent: boolean }): NativeNotice;
  sound(sound: NotificationSound, current?: () => boolean): Promise<void>; onClick(notice: DesktopNotice): void;
  onIssue(issue: 'delivery' | 'sound'): void;
}
export class NotificationManager {
  private disposed = false;
  private readonly active = new Map<string, { notice: DesktopNotice; native: NativeNotice; test: boolean; finish(result: NotificationDelivery): void }>();
  private readonly delivered = new Map<string, number>();
  constructor(private readonly options: Options) {}
  private allowed(notice: DesktopNotice, test: boolean): boolean {
    if (this.disposed) return false;
    const mode = this.options.preferences().modes[notice.category];
    return test || mode === 'always' || mode === 'background' && !this.options.isFocused();
  }
  send(notice: DesktopNotice, test = false): Promise<NotificationDelivery> {
    const now = Date.now();
    for (const [id, at] of this.delivered) if (now - at > 120_000) this.delivered.delete(id);
    if (!this.allowed(notice, test) || this.active.has(notice.id) || this.delivered.has(notice.id)) return Promise.resolve('suppressed');
    if (!this.options.isSupported()) { this.options.onIssue('delivery'); return Promise.reject(new Error('NOTIFICATION_UNAVAILABLE')); }
    if (notice.replaceKey) this.dismiss(value => value.replaceKey === notice.replaceKey);
    while (this.active.size >= 64) { const oldest = this.active.values().next().value!; this.dismiss(value => value.id === oldest.notice.id); }
    return new Promise((resolve, reject) => {
      let settled = false, shown = false;
      const timer = setTimeout(() => finish('requested'), 5000); timer.unref?.();
      const finish = (result: NotificationDelivery) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      let native: NativeNotice;
      try { native = this.options.create({ title: notice.title.slice(0, 180), body: notice.body.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 1200), silent: true }); }
      catch { clearTimeout(timer); this.options.onIssue('delivery'); reject(new Error('NOTIFICATION_FAILED')); return; }
      const record = { notice, native, test, finish };
      const current = () => !this.disposed && this.active.get(notice.id) === record;
      const failed = () => {
        if (!current()) return;
        this.active.delete(notice.id); this.delivered.delete(notice.id); clearTimeout(timer);
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
      native.on('click', () => { if (current()) { try { this.options.onClick(notice); } catch { this.options.onIssue('delivery'); } } });
      native.on('close', () => { if (current()) { this.active.delete(notice.id); finish('requested'); } });
      native.on('failed', failed);
      this.active.set(notice.id, record);
      try { native.show(); } catch { failed(); }
    });
  }
  dismiss(predicate: (notice: DesktopNotice) => boolean): void {
    for (const [id, record] of [...this.active]) if (predicate(record.notice)) {
      this.active.delete(id); record.finish('suppressed');
      try { record.native.close(); } catch { /* Removed objects must never become live again. */ }
    }
  }
  reconcile(): void { this.dismiss(notice => !this.allowed(notice, this.active.get(notice.id)?.test ?? false)); }
  dispose(): void { this.dismiss(() => true); this.disposed = true; this.delivered.clear(); }
}
