import { createServer, createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NotificationAction } from '../../shared/notifications.js';

export const NOTIFICATION_ACTIVATION_FLAG = '--quotern-notification-action';

/** The helper never imports the normal main process or claims a runtime/profile. */
export async function forwardNotificationActivation(argv: readonly string[]): Promise<boolean> {
  const index = argv.indexOf(NOTIFICATION_ACTIVATION_FLAG), pipe = argv[index + 1];
  const url = argv.find(value => /^[a-z][a-z0-9-]*:\/\/(view|snooze|dismiss-all)\//i.test(value));
  if (index < 0 || !pipe || !url || url.length > 4096 || !/^quotern-notifications-[a-f0-9-]+(?:\.sock)?$/.test(path.basename(pipe.replace(/^\\\\\.\\pipe\\/, '')))) return false;
  return new Promise(resolve => {
    let data = '', settled = false;
    const finish = (result: boolean) => { if (!settled) { settled = true; socket.destroy(); resolve(result); } };
    const socket = createConnection(pipe);
    socket.setTimeout(2000, () => finish(false));
    socket.on('error', () => finish(false)); socket.on('close', () => finish(false));
    socket.on('connect', () => socket.write(JSON.stringify({ url }) + '\n'));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 4096) { finish(false); return; }
      if (data.includes('\n')) { try { finish(JSON.parse(data.slice(0, data.indexOf('\n'))).ok === true); } catch { finish(false); } }
    });
  });
}

export async function createNotificationActivation(scheme: string, onAction: (id: string, action: NotificationAction) => boolean | void) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(scheme)) throw new Error('Invalid notification scheme');
  const token = randomUUID(), name = `quotern-notifications-${randomUUID()}`;
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(tmpdir(), `${name}.sock`);
  const sockets = new Set<ReturnType<typeof createConnection>>();
  let disposed = false;
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString(); if (data.length > 4096) { socket.destroy(); return; }
      if (!data.includes('\n')) return;
      let ok = false;
      try {
        const url = new URL(JSON.parse(data.slice(0, data.indexOf('\n'))).url);
        const id = decodeURIComponent(url.pathname.slice(1));
        if (!disposed && url.protocol === `${scheme}:` && (url.hostname === 'view' || url.hostname === 'snooze' || url.hostname === 'dismiss-all') && url.searchParams.get('token') === token && id && id.length <= 256) ok = onAction(id, url.hostname) !== false;
      } catch { /* Malformed/expired activations do nothing. */ }
      socket.removeAllListeners('data'); socket.end(JSON.stringify({ ok }) + '\n');
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  return {
    pipe,
    url: (id: string, action: NotificationAction) => `${scheme}://${action}/${encodeURIComponent(id)}?token=${token}`,
    dispose() { disposed = true; for (const socket of sockets) socket.destroy(); server.close(); },
  };
}
