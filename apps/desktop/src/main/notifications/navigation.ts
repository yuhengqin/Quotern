import { randomUUID } from 'node:crypto';
import type { SessionNavigation, SessionNavigationTarget } from '../../shared/agent-activity.js';

/** Renderer rebuilds preserve the latest click until that exact request is acknowledged. */
export class NotificationNavigation {
  private pending: SessionNavigation | null = null;
  open(target: SessionNavigationTarget): SessionNavigation { this.pending = { ...target, navigationId: randomUUID() }; return { ...this.pending }; }
  peek(): SessionNavigation | null { return this.pending && { ...this.pending }; }
  acknowledge(id: string): void { if (this.pending?.navigationId === id) this.pending = null; }
}
