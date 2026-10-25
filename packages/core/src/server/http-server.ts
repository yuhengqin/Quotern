import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Hono } from 'hono';

import { isApiPath, serveStatic } from './static.js';
import { DEFAULT_PORT } from '../paths.js';
import { MAX_BACKGROUND_REQUEST_BYTES, SHARE_BACKGROUNDS_ROUTE, ShareBackgroundError } from '../share-backgrounds.js';
import { SESSION_ACTIONS_ROUTE } from './session-actions-api.js';

export interface HttpServerOptions {
  honoApp: Hono;
  staticDir: string;
  host?: string;
  port?: number;
}

export function createHttpServer(opts: HttpServerOptions): Server {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? DEFAULT_PORT;

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const sessionAction = url.split('?')[0]!.replace(/\/$/, '') === SESSION_ACTIONS_ROUTE;

    if (isApiPath(url)) {
      try {
        const limit = sessionAction ? 4096 : url.split('?')[0] === SHARE_BACKGROUNDS_ROUTE ? MAX_BACKGROUND_REQUEST_BYTES : Infinity;
        if (Number(req.headers['content-length']) > limit) throw new ShareBackgroundError('背景请求超过大小限制', 413);
        const body =
          req.method !== 'GET' && req.method !== 'HEAD'
            ? await readBody(req, limit)
            : undefined;

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        }

        const response = await opts.honoApp.fetch(
          new Request(sessionAction ? `http://${req.headers.host ?? 'invalid.local'}${url}` : `http://${host}:${port}${url}`, {
            method: req.method,
            headers,
            body: body as BodyInit | undefined,
          }),
          { quoternRemoteAddress: req.socket.remoteAddress },
        );

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const buf = Buffer.from(await response.arrayBuffer());
        res.end(buf);
      } catch (err) {
        if (err instanceof ShareBackgroundError) {
          res.statusCode = err.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: false, message: sessionAction ? 'INVALID_SESSION_ACTION' : err.message, data: null }));
          req.resume();
          return;
        }
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(err instanceof Error ? err.message : 'Internal error');
      }
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(opts.staticDir, req, res);
      return;
    }

    res.statusCode = 405;
    res.end('Method not allowed');
  });

  return server;
}

function readBody(req: import('node:http').IncomingMessage, limit: number): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { chunks.length = 0; reject(new ShareBackgroundError('背景请求超过大小限制', 413)); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) resolve(undefined);
      else resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
}

export function listenServer(
  server: Server,
  host: string,
  port: number,
): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ port: actualPort });
    });
  });
}
