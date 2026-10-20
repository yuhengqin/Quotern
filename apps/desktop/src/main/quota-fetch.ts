import { session } from 'electron';
import { observeQuotaResponse } from './quota-fetch-state';
import { createQuotaTransport } from './quota-transport';

let transport: ReturnType<typeof createQuotaTransport> | null = null;
function getTransport() {
  // An in-memory session keeps recovery away from renderer/update connections.
  return transport ??= createQuotaTransport(session.fromPartition('quotern-quota-network', { cache: false }));
}

export async function recoverQuotaNetwork(): Promise<void> { await getTransport().recover(); }

/** Observe only status/cooldown data within the active provider read; never retain headers or credentials. */
export async function quotaFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  const response = await getTransport().fetch(input, init);
  observeQuotaResponse(response);
  return response;
}
