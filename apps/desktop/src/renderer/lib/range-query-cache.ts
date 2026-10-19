export interface RangeQuerySnapshot<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

interface PendingRangeQuery<T> {
  token: unknown;
  promise: Promise<void>;
  queuedLoad?: () => Promise<T>;
}

/** Session-scoped caches must also stay bounded for custom dates and filters. */
export function rememberRangeValue<T>(cache: Map<string, T>, key: string, value: T, limit = 24): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

/** Keep each scope's last reading while its next request is in flight. */
export class RangeQueryCache<T> {
  private readonly entries = new Map<string, RangeQuerySnapshot<T>>();
  private readonly pending = new Map<string, PendingRangeQuery<T>>();
  private readonly listeners = new Set<() => void>();
  private readonly empty: RangeQuerySnapshot<T> = { data: null, loading: true, error: false };
  private readonly limit: number;

  constructor(limit = 24) { this.limit = Math.max(1, limit); }

  getSnapshot = (key: string): RangeQuerySnapshot<T> => this.entries.get(key) ?? this.empty;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  refresh(key: string, token: unknown, load: () => Promise<T>, refreshAfterPending = false): Promise<void> {
    const pending = this.pending.get(key);
    if (pending && pending.token === token) {
      if (refreshAfterPending) pending.queuedLoad = load;
      return pending.promise;
    }
    const previous = this.getSnapshot(key);
    if (previous.error) this.publish(key, { data: previous.data, loading: previous.data === null, error: false });
    const request: PendingRangeQuery<T> = { token, promise: Promise.resolve() };
    this.pending.set(key, request);
    request.promise = Promise.resolve().then(load).then(
      data => {
        if (this.pending.get(key) === request) this.publish(key, { data, loading: false, error: false });
      },
      () => {
        if (this.pending.get(key) === request) this.publish(key, { data: this.getSnapshot(key).data, loading: false, error: true });
      },
    ).finally(() => {
      if (this.pending.get(key) === request) {
        this.pending.delete(key);
        if (request.queuedLoad) return this.refresh(key, token, request.queuedLoad);
      }
    });
    return request.promise;
  }

  private publish(key: string, snapshot: RangeQuerySnapshot<T>): void {
    rememberRangeValue(this.entries, key, snapshot, this.limit);
    for (const listener of this.listeners) listener();
  }
}
