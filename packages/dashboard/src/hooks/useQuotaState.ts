import { useSyncExternalStore } from 'react';
import type { QuotaState, QuotaPreferencePatch } from 'quotern-core/quota/shared/quota';
import { request } from '../lib/api';
import { subscribeAutomaticRefresh } from '../lib/dashboard-refresh';

type QuotaSnapshot = { state: QuotaState | null; error: string | null };
const initial: QuotaSnapshot = { state: null, error: null };
const listeners = new Set<() => void>();
let snapshot = initial;
let version = 0;
let pending = 0;
let stopPolling: (() => void) | undefined;

function publish(next: QuotaSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function update(operation: 'read' | 'refresh' | 'preferences', body?: QuotaPreferencePatch | { provider: string }) {
  const current = ++version;
  pending++;
  try {
    const path = operation === 'read' ? '/functions/tud-quota' : `/functions/tud-quota/${operation}`;
    const state = await request<QuotaState>(path, {
      signal: AbortSignal.timeout(30_000),
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (current === version) publish({ state, error: null });
  } catch (cause) {
    if (current === version) {
      const previous = snapshot.state;
      if (operation === 'preferences') publish({ state: previous, error: 'usage.quota.saveFailed' });
      else publish({ state: previous && { ...previous, providers: previous.providers.map(provider => ({ ...provider, stale: true, refreshing: false })) }, error: 'usage.quota.loadFailed' });
    }
    if (operation !== 'read') throw cause;
  } finally {
    pending--;
  }
}

const refresh = (provider?: string) => provider ? update('refresh', { provider }) : update('read');
const save = (patch: QuotaPreferencePatch) => update('preferences', patch);
const getSnapshot = () => snapshot;

// The settings dialog and the dashboard read the same CLI state, including account switches.
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    stopPolling = subscribeAutomaticRefresh(() => {
      if (!document.hidden && !pending) void refresh();
    }, { intervalMs: 15_000 });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopPolling?.();
      stopPolling = undefined;
      version++;
      snapshot = initial;
    }
  };
}

export function useQuotaState() {
  return { ...useSyncExternalStore(subscribe, getSnapshot, getSnapshot), refresh, save };
}
