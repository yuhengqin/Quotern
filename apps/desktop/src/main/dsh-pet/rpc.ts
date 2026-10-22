import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RpcRequest, RpcResponse } from '../../shared/dsh-pet.js';

type Handler = (request: RpcRequest, signal: AbortSignal) => Promise<RpcResponse>;
const allowed = (method: string, url: string): boolean => {
  const route = url.split('?')[0];
  return method === 'GET'
    ? /^\/dsh-pet-7340\/(?:config|state|playback\/[a-zA-Z0-9-]+)$/.test(route!) || /^\/dsh-pet-7340\/(?:thumb|pic|font)\//.test(route!)
    : method === 'POST' && /^\/dsh-pet-7340\/(?:balance|reload|pet-display|anim|broadcast|open-host|open-settings|sync|position|throw|lock|lock\/release|playback\/[a-zA-Z0-9-]+\/report)$/.test(route!);
};

export class DshPetRpcServer {
  private server: Server | null = null;
  private readonly clients = new Set<Socket>();
  constructor(private readonly options: { maxBytes?: number; timeoutMs?: number } = {}) {}
  async start(handler: Handler): Promise<{ endpoint: string; token: string }> {
    if (this.server) throw new Error('dsh-pet pipe already started');
    const token = randomBytes(32).toString('hex');
    const id = `quotern-dsh-pet-${process.pid}-${randomBytes(12).toString('hex')}`;
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(tmpdir(), `${id}.sock`);
    const maxBytes = this.options.maxBytes ?? 1024 * 1024;
    const server = createServer(socket => {
      this.clients.add(socket);
      let pending = Buffer.alloc(0);
      const requests = new Map<number, AbortController>();
      socket.on('error', () => socket.destroy());
      socket.once('close', () => { this.clients.delete(socket); for (const abort of requests.values()) abort.abort(); requests.clear(); });
      socket.on('data', chunk => {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length > maxBytes) { socket.destroy(); return; }
        for (let end = pending.indexOf(10); end !== -1; end = pending.indexOf(10)) {
          const line = pending.subarray(0, end).toString('utf8');
          pending = pending.subarray(end + 1);
          let input: Record<string, unknown>;
          try { input = JSON.parse(line) as Record<string, unknown>; } catch { socket.destroy(); return; }
          const supplied = typeof input?.token === 'string' ? Buffer.from(input.token) : Buffer.alloc(0);
          if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) { socket.destroy(); return; }
          if (!Number.isSafeInteger(input.id) || (input.id as number) <= 0 || requests.has(input.id as number) || requests.size >= 64 || typeof input.method !== 'string' || typeof input.url !== 'string' || input.url.length > 4096 || !allowed(input.method, input.url) || (input.body !== undefined && typeof input.body !== 'string')) { socket.destroy(); return; }
          const request: RpcRequest = { id: input.id as number, method: input.method, url: input.url, ...(input.body !== undefined ? { body: input.body as string } : {}) };
          const abort = new AbortController();
          requests.set(request.id, abort);
          const send = (response: RpcResponse) => {
            if (socket.destroyed) return;
            let message = JSON.stringify({ id: request.id, ...response }) + '\n';
            if (Buffer.byteLength(message) > maxBytes) message = JSON.stringify({ id: request.id, status: 413 }) + '\n';
            socket.write(message);
          };
          const timeout = setTimeout(() => abort.abort(new Error('dsh-pet request timeout')), this.options.timeoutMs ?? 65_000);
          timeout.unref();
          const cancelled = new Promise<RpcResponse>(resolve => abort.signal.addEventListener('abort', () => resolve({ status: 504 }), { once: true }));
          void Promise.race([Promise.resolve().then(() => handler(request, abort.signal)), cancelled])
            .then(send, () => send({ status: 500, body: '{"ok":false,"reason":"host-error"}' }))
            .finally(() => { clearTimeout(timeout); requests.delete(request.id); });
        }
      });
    });
    server.maxConnections = 4;
    this.server = server;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, () => { server.removeListener('error', reject); resolve(); }); });
    return { endpoint, token };
  }
  async close(): Promise<void> {
    for (const client of this.clients) client.destroy();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
