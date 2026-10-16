import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuotaState } from 'quotern-core/quota/shared/quota';
import { request } from '../lib/api';

export function useQuotaState() {
  const [state, setState] = useState<QuotaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const version = useRef(0);
  const pending = useRef(0);
  const load = useCallback(async (provider?: string) => {
    const current = ++version.current;
    pending.current++;
    try {
      const next = await request<QuotaState>(`/functions/tud-quota${provider ? '/refresh' : ''}`, {
        signal: AbortSignal.timeout(30_000),
        ...(provider ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) } : {}),
      });
      if (active.current && current === version.current) { setState(next); setError(null); }
    } catch (cause) {
      if (active.current && current === version.current) {
        setError('暂时无法读取订阅额度，请确认本地服务已更新并正在运行');
        setState(previous => previous ? { ...previous, providers: previous.providers.map(item => ({ ...item, stale: true, refreshing: false })) } : null);
      }
      if (provider) throw cause;
    } finally { pending.current--; }
  }, []);
  useEffect(() => {
    active.current = true;
    void load();
    const poll = () => { if (!document.hidden && !pending.current) void load(); };
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => { active.current = false; version.current++; window.clearInterval(timer); window.removeEventListener('focus', poll); document.removeEventListener('visibilitychange', poll); };
  }, [load]);
  return { state, error, refresh: load };
}
