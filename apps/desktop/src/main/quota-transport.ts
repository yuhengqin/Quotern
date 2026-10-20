export interface QuotaNetworkSession {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  forceReloadProxyConfig(): Promise<void>;
  closeAllConnections(): Promise<void>;
}
export function createQuotaTransport(network: QuotaNetworkSession) {
  let active = 0;
  let recovery: Promise<void> | null = null;
  const idle = new Set<() => void>();
  const recover = (): Promise<void> => {
    if (recovery) return recovery;
    const operation = Promise.resolve().then(async () => {
      // Closing a session's connections aborts in-flight requests. Let them finish
      // first, and hold new requests at the recovery gate.
      if (active) await new Promise<void>(resolve => idle.add(resolve));
      await network.forceReloadProxyConfig();
      await network.closeAllConnections();
    });
    const shared = operation.finally(() => { if (recovery === shared) recovery = null; });
    recovery = shared;
    return shared;
  };
  const wait = async <T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> => {
    signal?.throwIfAborted();
    if (!signal) return promise;
    let abort!: () => void;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      })]);
    } finally { signal.removeEventListener('abort', abort); }
  };
  const attempt = async (input: string | Request, init?: RequestInit): Promise<Response> => {
    active++;
    try {
      const response = await network.fetch(input, init);
      // Surface truncated JSON bodies here too, before a reader leaves this
      // recovery boundary. The original response and all its metadata survive.
      if (response.ok && response.body) await response.clone().arrayBuffer();
      return response;
    } finally {
      active--;
      if (!active) { for (const resolve of idle) resolve(); idle.clear(); }
    }
  };
  return {
    recover,
    fetch: async (input: string | Request, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal ?? (typeof input === 'string' ? undefined : input.signal);
      const method = (init?.method ?? (typeof input === 'string' ? 'GET' : input.method)).toUpperCase();
      signal?.throwIfAborted();
      if (recovery) await wait(recovery, signal);
      try { return await attempt(input, init); }
      catch (error) {
        signal?.throwIfAborted();
        const details = error as { message?: string; code?: string };
        const code = details?.message?.match(/\bnet::(ERR_[A-Z0-9_]+)\b/)?.[1] ?? details?.code;
        if (!['GET', 'HEAD'].includes(method) || !code || ![
          'ERR_NETWORK_CHANGED', 'ERR_NETWORK_IO_SUSPENDED', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET',
        ].includes(code)) throw error;
        await wait(recover(), signal);
        signal?.throwIfAborted();
        return attempt(input, init);
      }
    },
  };
}
