import type { QuotaState } from '../shared/quota';

interface RuntimeQuota {
  getState(): QuotaState | null;
  directory: string;
}

let quota: RuntimeQuota | undefined;

export function bindRuntimeQuota(value: RuntimeQuota): () => void {
  quota = value;
  return () => { if (quota === value) quota = undefined; };
}

export function getQuotaRuntimeState(): QuotaState | null { return quota?.getState() ?? null; }
export function getQuotaBackupDirectory(): string | undefined { return quota?.directory; }
