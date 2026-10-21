import { randomUUID } from 'node:crypto';
import type { SessionNavigation, SessionNavigationTarget } from '../../shared/dsh-pet.js';

/** Survives closing/rebuilding the renderer, with latest-click-wins acknowledgement. */
export class NotificationNavigation {
  private pending: SessionNavigation | null = null;
  open(target: SessionNavigationTarget): SessionNavigation {
    this.pending = { ...target, navigationId: randomUUID() };
    return { ...this.pending };
  }
  peek(): SessionNavigation | null { return this.pending && { ...this.pending }; }
  acknowledge(id: string): void { if (this.pending?.navigationId === id) this.pending = null; }
}
