import { net } from 'electron';
import { observeQuotaResponse } from './quota-fetch-state';

/** Observe only status/cooldown data within the active provider read; never retain headers or credentials. */
export async function quotaFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  const response = await net.fetch(input, init);
  observeQuotaResponse(response);
  return response;
}
