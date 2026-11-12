import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readAgentPreferences, patchAgentPreferences, agentDirectory } from '../agent/preferences.js';
import { integrationStatus, setIntegrationInstalled } from '../agent/install.js';
import { prepareHandoff, saveHandoff } from '../agent/handoff.js';
import { prepareClaudePlugin } from '../agent/plugin.js';
import { validSessionActionTarget } from '../session-resume.js';
import { readWindowStartStatus } from '../agent/window-start.js';
import type { QuotaState } from '../quota/shared/quota.js';
import { readAgentActivities } from '../agent/activity.js';

export function registerAgentApi(parent: Hono, dataDir: string, ipc = false, getQuotaState: () => QuotaState | null = () => null) {
  const app = new Hono<{ Bindings: { quoternRemoteAddress?: string } }>(), token = randomBytes(32).toString('hex');
  const ok = <T>(data: T) => ({ success: true, message: 'ok', data });
  const fail = (message: string) => ({ success: false, message, data: null });
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const peer = c.env?.quoternRemoteAddress, host = new URL(c.req.url).hostname;
    const loopback = ['localhost', '127.0.0.1', '[::1]'];
    let localOrigin = true;
    try { const origin = c.req.header('Origin'); if (origin) { const url = new URL(origin); localOrigin = ['http:', 'https:'].includes(url.protocol) && loopback.includes(url.hostname); } const rawHost = c.req.header('Host'); if (rawHost && ![...loopback, ...(ipc ? ['tud.local'] : [])].includes(new URL(`http://${rawHost}`).hostname)) localOrigin = false; } catch { localOrigin = false; }
    if (!localOrigin || !loopback.includes(host) && !(ipc && host === 'tud.local') || peer && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return c.json(fail('AGENT_LOCAL_ONLY'), 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 40000, onError: c => c.json(fail('AGENT_INVALID_REQUEST'), 413) }));
  const status = async () => ({ preferences: await readAgentPreferences(dataDir), agents: await integrationStatus(dataDir), windowStart: await readWindowStartStatus(dataDir, getQuotaState()), token, isolated: process.env.QUOTERN_DEV_ISOLATED === '1' });
  app.get('/', async c => { try { return c.json(ok(await status())); } catch { return c.json(fail('AGENT_INVALID_CONFIG'), 400); } });
  app.get('/activity', async c => { try { return c.json(ok(await readAgentActivities(dataDir))); } catch { return c.json(fail('AGENT_ACTIVITY_UNAVAILABLE'), 400); } });
  app.post('/', async c => {
    const supplied = Buffer.from(c.req.header('X-Quotern-Agent-Action') ?? ''), expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return c.json(fail('AGENT_FORBIDDEN'), 403);
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(fail('AGENT_INVALID_REQUEST'), 400);
    try {
      const body = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('AGENT_INVALID_REQUEST');
      const keys: Record<string, string[]> = { preferences: ['patch'], installation: ['agent', 'installed'], plugin: [], preview: ['source', 'sessionId'], handoff: ['source', 'sessionId', 'text'] };
      if (!Object.hasOwn(keys, body.action) || Object.keys(body).some(key => key !== 'action' && !keys[body.action]!.includes(key))) throw new Error('AGENT_INVALID_REQUEST');
      if (body.action === 'preferences') await patchAgentPreferences(dataDir, body.patch);
      else if (body.action === 'installation') {
        if (!['claude', 'codex'].includes(body.agent) || typeof body.installed !== 'boolean') throw new Error('AGENT_INVALID_REQUEST');
        await setIntegrationInstalled(dataDir, body.agent, body.installed, process.env.QUOTERN_DEV_ISOLATED === '1' ? { directory: join(agentDirectory(dataDir), 'hosts', body.agent) } : {});
      } else if (body.action === 'plugin') return c.json(ok(await prepareClaudePlugin(dataDir)));
      else {
        if (!validSessionActionTarget(body.source, body.sessionId)) throw new Error('AGENT_INVALID_REQUEST');
        if (body.action === 'preview') return c.json(ok(await prepareHandoff(dataDir, body.source, body.sessionId)));
        await saveHandoff(dataDir, body.source, body.sessionId, body.text);
      }
      return c.json(ok(await status()));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return c.json(fail(/^(AGENT|SESSION_DIRECTORY)_[A-Z_]+$/.test(message) ? message : 'AGENT_OPERATION_FAILED'), 400);
    }
  });
  parent.route('/functions/tud-agent', app);
}
