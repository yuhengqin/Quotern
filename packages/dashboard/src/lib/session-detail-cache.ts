import type { SessionActivity } from 'quotern-core';
import type { DetailRange } from './session-detail.ts';
import { appendDashboardRangeQuery } from './dashboard-date-range.ts';

export type SessionIdentity = Pick<SessionActivity, 'source' | 'sessionId'>;
const identityKey = (value: SessionIdentity) => JSON.stringify([value.source, value.sessionId]);

/** One cache per open detail chain and frozen period, containing complete rows only. */
export class SessionDetailCache {
  private readonly rows = new Map<string, SessionActivity>();
  private readonly loaded = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private readonly read: (source: string) => Promise<readonly SessionActivity[]>;

  constructor(read: (source: string) => Promise<readonly SessionActivity[]>, rows: readonly SessionActivity[] = []) {
    this.read = read;
    this.seed(rows);
  }

  seed(rows: readonly SessionActivity[]): void { for (const row of rows) this.rows.set(identityKey(row), row); }
  get(value: SessionIdentity): SessionActivity | undefined { return this.rows.get(identityKey(value)); }

  load(value: SessionIdentity, retry = false): Promise<SessionActivity | null> {
    const row = this.get(value);
    if (row && !retry) return Promise.resolve(row);
    const source = value.source;
    let pending = this.pending.get(source);
    if (!pending) {
      if (this.loaded.has(source) && !retry) return Promise.resolve(null);
      pending = new Promise<readonly SessionActivity[]>((resolve, reject) => {
        const start = () => {
          this.active++;
          void Promise.resolve().then(() => this.read(source)).then(resolve, reject).finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
        };
        if (this.active < 2) start(); else this.queue.push(start);
      }).then(rows => { this.seed(rows.filter(row => row.source === source)); this.loaded.add(source); })
        .finally(() => { this.pending.delete(source); });
      this.pending.set(source, pending);
    }
    return pending.then(() => this.get(value) ?? null);
  }
}

/** Fetch siblings together, using the parent's actual bounds rather than a live preset. */
export function sessionDetailQuery(source: string, range?: DetailRange): string {
  const query = new URLSearchParams({ sources: source, days: '365' });
  if (range) appendDashboardRangeQuery(query, { start: range.fromDate, end: range.toDate, fromTime: range.fromTime, toTime: range.toTime });
  return `/functions/tud-session-activity?${query}`;
}
