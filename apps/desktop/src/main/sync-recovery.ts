export function createRecoverableSync<T>(deps: {
  run(reason: string, source?: string): Promise<T>;
  apply(results: T, reason: string): Promise<void>;
  recover(): Promise<void>;
  onRecoveryError?(error: unknown): void;
}): (reason: string, source?: string) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  let needsRecovery = false;
  const recover = async () => { await deps.recover(); needsRecovery = false; };
  return (reason, source) => {
    if (inFlight) return inFlight;
    const operation = (async () => {
      if (needsRecovery) await recover();
      try {
        const results = await deps.run(reason, source);
        await deps.apply(results, reason);
        return results;
      } catch (error) {
        // A worker may commit buckets/cursors before its final reply is lost.
        needsRecovery = true;
        try { await recover(); } catch (recoveryError) { deps.onRecoveryError?.(recoveryError); }
        throw error;
      }
    })();
    const shared = operation.finally(() => { if (inFlight === shared) inFlight = null; });
    inFlight = shared;
    return shared;
  };
}
