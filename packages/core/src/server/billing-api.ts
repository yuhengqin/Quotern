import type { Hono } from 'hono';
import { BillingService } from '../quota/billing-store.js';
import { validBillingOrganization, validBillingSource } from '../quota/billing.js';
import { CLAUDE_BILLING_ROUTE, actionFailure, actionOk, createLocalActionApi } from './local-action-api.js';

export function registerBillingApi(parent: Hono, options: { dataDir?: string; ipc?: boolean; service?: BillingService }) {
  const service = options.service ?? new BillingService(options.dataDir!), { app, token } = createLocalActionApi('X-Quotern-Billing-Action', options.ipc);
  const view = async () => ({ token, connections: await service.view() });
  app.onError((_error, c) => c.json(actionFailure('BILLING_REQUEST_FAILED'), 500));
  app.get('/', async c => c.json(actionOk(await view())));
  app.post('/', async c => {
    let body: Record<string, unknown>;
    try { body = await c.req.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
    catch { return c.json(actionFailure('LOCAL_ACTION_INVALID'), 400); }
    const keys = body.action === 'discover' ? ['action', 'source', 'cookie'] : body.action === 'connect' ? ['action', 'source', 'cookie', 'organizationId', 'revision'] : ['refresh', 'disconnect'].includes(body.action as string) ? ['action', 'source', 'revision'] : [];
    if (!keys.length || Object.keys(body).some(key => !keys.includes(key)) || !validBillingSource(body.source)
      || ['discover', 'connect'].includes(body.action as string) && typeof body.cookie !== 'string'
      || body.action === 'connect' && !validBillingOrganization(body.organizationId)
      || body.action !== 'discover' && (typeof body.revision !== 'string' || body.revision.length > 64)) return c.json(actionFailure('LOCAL_ACTION_INVALID'), 400);
    try {
      if (body.action === 'discover') return c.json(actionOk(await service.discover(body.source, body.cookie as string)));
      if (body.action === 'connect') await service.connect(body.source, body.cookie as string, body.organizationId as string, body.revision as string);
      else if (body.action === 'disconnect') await service.disconnect(body.source, body.revision as string);
      else await service.refresh(body.source, body.revision as string);
      return c.json(actionOk(await view()));
    } catch (error) {
      const message = error instanceof Error && /^BILLING_[A-Z_]+$/.test(error.message) ? error.message : 'BILLING_REQUEST_FAILED';
      return c.json(actionFailure(message), message === 'BILLING_CONFLICT' || message === 'BILLING_PENDING' ? 409 : 400);
    }
  });
  parent.route(CLAUDE_BILLING_ROUTE, app);
}
