import type { ActivityEvent, SessionNavigationTarget } from '../../shared/agent-activity.js';
import type { DesktopNotice, NotificationCategory } from '../../shared/notifications.js';

interface Options {
  send(notice: DesktopNotice): Promise<unknown>; dismiss(predicate: (notice: DesktopNotice) => boolean): void;
  text(kind: 'complete' | 'confirmation' | 'error', source: string): { title: string; body: string };
  now?(): number;
}
/** Reconcile log and hook signals without letting pet lifetime govern notifications. */
export class AgentNotificationEvents {
  private readonly seen = new Set<string>();
  private readonly recent = new Map<string, { at: number; turn?: string }>();
  private readonly terminalAt = new Map<string, number>();
  private readonly startedAt = new Map<string, number>();
  constructor(private readonly options: Options) {}
  accept(event: ActivityEvent): void {
    const now = this.options.now?.() ?? Date.now(), at = Date.parse(event.timestamp);
    if (!['codex', 'claude', 'dsh'].includes(event.source) || !event.sessionId || event.sessionId.length > 256 || /[\x00-\x1f\x7f]/.test(event.sessionId) || !Number.isFinite(at) || now - at > 120_000 || at - now > 60_000 || this.seen.has(event.id)) return;
    this.seen.add(event.id); if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!);
    const session = `${event.source}:${event.sessionId}`;
    if (at < (this.startedAt.get(session) ?? 0)) return;
    // SessionEnd/Interrupt only retire pending questions. The durable result can
    // be read later than that quiet hook and must still report an explicit error.
    const terminalNotice = event.terminal && (event.notice === 'complete' || event.notice === 'error');
    if (at < (this.terminalAt.get(session) ?? 0) && !terminalNotice) return;
    const sameSession = (value: DesktopNotice) => value.sessionKey === session;
    // Log and Hook readers advance independently. Older lifecycle records may not
    // withdraw a newer question, nor announce a previous turn after the next start.
    const preceding = (value: DesktopNotice) => sameSession(value) && (value.occurredAt ?? 0) <= at;
    if (event.newTurn) {
      this.startedAt.set(session, at);
      if (this.startedAt.size > 2000) this.startedAt.delete(this.startedAt.keys().next().value!);
      this.options.dismiss(preceding);
      for (const [key, recent] of this.recent) if (key.startsWith(session + '\0') && recent.at <= at) this.recent.delete(key);
    }
    if (event.resolvedRequestId || event.resolvedRequestKey) this.options.dismiss(value => preceding(value) && value.category === 'agentConfirmation' && (event.resolvedRequestId !== undefined && value.requestId === event.resolvedRequestId || event.resolvedRequestKey !== undefined && value.requestId === event.resolvedRequestKey));
    if (event.terminal) {
      this.terminalAt.set(session, Math.max(at, this.terminalAt.get(session) ?? 0));
      if (this.terminalAt.size > 2000) this.terminalAt.delete(this.terminalAt.keys().next().value!);
      this.options.dismiss(value => preceding(value) && value.category === 'agentConfirmation');
    }
    if (!event.notice || event.notice === 'confirmation' && at <= (this.terminalAt.get(session) ?? 0)) return;
    const key = `${session}\0${event.notice}\0${event.requestId ?? ''}`, previous = this.recent.get(key);
    if (previous && Math.abs(at - previous.at) < 5000 && (!previous.turn || !event.turnId || previous.turn === event.turnId)) return;
    this.recent.set(key, { at, turn: event.turnId });
    if (this.recent.size > 2000) this.recent.delete(this.recent.keys().next().value!);
    const category: NotificationCategory = event.notice === 'complete' ? 'agentComplete' : event.notice === 'confirmation' ? 'agentConfirmation' : 'agentError';
    const target: SessionNavigationTarget = { source: event.source as SessionNavigationTarget['source'], sessionId: event.sessionId };
    const text = this.options.text(event.notice, event.source);
    void this.options.send({ id: event.id, category, ...text, target: { kind: 'session', value: target }, sessionKey: session, requestId: event.requestId, replaceKey: key, occurredAt: at }).catch(() => {});
  }
}
