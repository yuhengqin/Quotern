import { connect } from 'node:net';
import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { RpcResponse } from '../../shared/dsh-pet.js';

export function connectHost(endpoint: string, token: string, onDisconnect: () => void) {
  const socket = connect(endpoint);
  let sequence = 0, pending = Buffer.alloc(0), closed = false;
  const requests = new Map<number, { resolve(value: RpcResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const ready = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.on('error', () => socket.destroy());
  socket.once('close', () => { for (const entry of requests.values()) { clearTimeout(entry.timer); entry.reject(new Error('host disconnected')); } requests.clear(); if (!closed) onDisconnect(); });
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 1024 * 1024) { socket.destroy(); return; }
    for (let end = pending.indexOf(10); end !== -1; end = pending.indexOf(10)) {
      const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
      try { const response = JSON.parse(line.toString('utf8')) as RpcResponse & { id: number }; const entry = requests.get(response.id); if (entry) { requests.delete(response.id); clearTimeout(entry.timer); entry.resolve(response); } } catch { socket.destroy(); }
    }
  });
  return {
    ready,
    async request(method: string, url: string, body?: string): Promise<RpcResponse> {
      await ready; if (socket.destroyed || closed || requests.size >= 64) throw new Error('host unavailable');
      return new Promise((resolve, reject) => {
        const id = ++sequence, message = JSON.stringify({ id, token, method, url, ...(body !== undefined ? { body } : {}) }) + '\n';
        if (Buffer.byteLength(message) > 1024 * 1024) { reject(new Error('request too large')); return; }
        const timer = setTimeout(() => { requests.delete(id); reject(new Error('host request timeout')); }, 65_000); timer.unref();
        requests.set(id, { resolve, reject, timer }); socket.write(message);
      });
    },
    close() { closed = true; socket.destroy(); },
  };
}

/** Media stays off the pipe; stream the selected byte range from the host-approved file. */
export async function fileResponse(file: string, range: string | null, contentType?: string): Promise<Response> {
  const handle = await open(file, 'r'); const size = (await handle.stat()).size; await handle.close();
  const headers: Record<string, string> = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', ...(contentType ? { 'content-type': contentType } : {}) };
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start < 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    status = 206; headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = String(Math.max(0, end - start + 1));
  return new Response(size ? Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array> : null, { status, headers });
}
