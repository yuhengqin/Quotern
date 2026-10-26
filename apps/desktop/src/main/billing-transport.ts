import type { QuotaNetworkSession } from './quota-transport';
/** Billing's Core reader owns bounded stream consumption; never clone or buffer here. */
export function createBillingTransport(network: Pick<QuotaNetworkSession, 'fetch'>) {
  return (input: string, init: RequestInit): Promise<Response> => network.fetch(input, init);
}
