import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readSessionDirectory } from '../session-directory.js';
import { existingSessionDirectory, nativeSessionActions, type SessionActionRuntime } from '../session-actions.js';
import { sessionResumeCommand, validSessionActionTarget } from '../session-resume.js';

export const SESSION_ACTIONS_ROUTE = '/functions/tud-session-actions';
const failure = (message: string) => ({ success: false as const, message, data: null });
const ok = <T>(data: T) => ({ success: true as const, message: 'ok', data });
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function localRequest(url: string, origin: string | undefined, ipc: boolean): boolean {
  try {
    const target = new URL(url);
    if (!loopback.has(target.hostname) && !(ipc && target.hostname === 'tud.local')) return false;
    if (!origin) return true; // Same-origin GETs and in-process IPC omit Origin.
    const source = new URL(origin);
    return ['http:', 'https:'].includes(source.protocol) && loopback.has(source.hostname);
  } catch { return false; }
}

export function registerSessionActionsApi(parent: Hono, dataDir: string, runtime: SessionActionRuntime = nativeSessionActions, ipc = false): void {
  const app = new Hono<{ Bindings: { quoternRemoteAddress?: string } }>();
  const token = randomBytes(32).toString('hex');
  const pending = new Set<string>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const peer = c.env?.quoternRemoteAddress;
    if (typeof peer === 'string' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
      || !localRequest(c.req.url, c.req.header('Origin'), ipc)) return c.json(failure('SESSION_ACTION_LOCAL_ONLY'), 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 4096, onError: c => c.json(failure('INVALID_SESSION_ACTION'), 413) }));
  app.get('/', async c => {
    const params = new URL(c.req.url).searchParams;
    const source = params.get('source'), sessionId = params.get('sessionId');
    if ([...params.keys()].some(key => !['source', 'sessionId'].includes(key) || params.getAll(key).length !== 1)
      || !validSessionActionTarget(source, sessionId)) return c.json(failure('INVALID_SESSION_TARGET'), 400);
    const directory = await readSessionDirectory(dataDir, source!, sessionId!);
    const available = await existingSessionDirectory(directory);
    return c.json(ok({ directory, token, canOpenDirectory: Boolean(available), canResume: Boolean(available && sessionResumeCommand(source!, sessionId!)), reason: available ? null : 'SESSION_DIRECTORY_UNAVAILABLE' }));
  });
  app.post('/', async c => {
    const supplied = Buffer.from(c.req.header('X-Quotern-Session-Action') ?? '');
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return c.json(failure('SESSION_ACTION_FORBIDDEN'), 403);
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(failure('INVALID_SESSION_ACTION'), 400);
    let input: unknown;
    try { input = await c.req.json(); } catch { return c.json(failure('INVALID_SESSION_ACTION'), 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json(failure('INVALID_SESSION_ACTION'), 400);
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some(key => !['action', 'source', 'sessionId'].includes(key))
      || (body.action !== 'open-directory' && body.action !== 'resume')
      || !validSessionActionTarget(body.source, body.sessionId)) return c.json(failure('INVALID_SESSION_ACTION'), 400);
    const source = body.source as string, sessionId = body.sessionId as string;
    const command = sessionResumeCommand(source, sessionId);
    if (body.action === 'resume' && !command) return c.json(failure('SESSION_RESUME_UNSUPPORTED'), 400);
    const key = JSON.stringify([source, sessionId]);
    if (pending.has(key)) return c.json(failure('SESSION_ACTION_PENDING'), 409);
    pending.add(key);
    try {
      const directory = await existingSessionDirectory(await readSessionDirectory(dataDir, source, sessionId));
      if (!directory) return c.json(failure('SESSION_DIRECTORY_UNAVAILABLE'), 400);
      if (body.action === 'open-directory') await runtime.openDirectory(directory);
      else await runtime.resume(directory, command!);
      return c.json(ok({ action: body.action }));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json(failure(['SESSION_CLI_UNAVAILABLE', 'SESSION_ACTION_UNSUPPORTED'].includes(code) ? code : 'SESSION_ACTION_LAUNCH_FAILED'), 500);
    } finally { pending.delete(key); }
  });
  parent.route(SESSION_ACTIONS_ROUTE, app);
}
