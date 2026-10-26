import { session } from 'electron';
import { createBillingTransport } from './billing-transport';
let fetch: ReturnType<typeof createBillingTransport> | null = null;
export function billingFetch(input: string, init: RequestInit): Promise<Response> {
  fetch ??= createBillingTransport(session.fromPartition('quotern-billing-network', { cache: false }));
  return fetch(input, init);
}
