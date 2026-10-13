import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Hono } from 'hono';

import { isApiPath, serveStatic } from './static.js';

export interface HttpServerOptions {
  honoApp: Hono;
  staticDir: string;
  host?: string;
  port?: number;
}

export function createHttpServer(opts: HttpServerOptions): Server {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 8452;

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';

    if (isApiPath(url)) {
      try {
        const body =
          req.method !== 'GET' && req.method !== 'HEAD'
            ? await readBody(req)
            : undefined;

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        }

        const response = await opts.honoApp.fetch(
          new Request(`http://${host}:${port}${url}`, {
            method: req.method,
            headers,
            body: body as BodyInit | undefined,
          }),
        );

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const buf = Buffer.from(await response.arrayBuffer());
        res.end(buf);
      } catch (err) {
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

function readBody(req: import('node:http').IncomingMessage): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) resolve(undefined);
      else resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    req.on('error', reject);
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
