import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isApiPath, serveStatic } from './static.js';
import { DEFAULT_PORT } from '../paths.js';
import { MAX_BACKGROUND_REQUEST_BYTES, SHARE_BACKGROUNDS_ROUTE, ShareBackgroundError } from '../share-backgrounds.js';
import { SESSION_ACTIONS_ROUTE } from './session-actions-api.js';
import { demoMetadata, type DemoMetadata } from '../demo/types.js';
import type { DemoBootstrap } from '../demo/bootstrap.js';

export interface HttpServerOptions {
  honoApp: Hono;
  staticDir: string;
  host?: string;
  port?: number;
  demo?: DemoMetadata;
  demoBootstrap?: DemoBootstrap;
}

export function createHttpServer(opts: HttpServerOptions): Server {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? DEFAULT_PORT;
  const demoHead = opts.demo ? `<script id="quotern-demo" type="application/json">${JSON.stringify(demoMetadata(opts.demo)).replace(/</g, '\\u003c')}</script>` : undefined;
  let dashboardHead = demoHead;
  if (opts.demo) {
    let preloads = '';
    try {
      const manifest = JSON.parse(readFileSync(join(opts.staticDir, 'demo-preload.json'), 'utf8'));
      if (manifest.schemaVersion === 1 && Array.isArray(manifest.modules) && Array.isArray(manifest.styles)) {
        preloads = [...manifest.modules.filter((p: unknown) => typeof p === 'string' && /^assets\/[\w.-]+\.js$/.test(p)).map((p: string) => `<link rel="modulepreload" crossorigin href="/${p}">`),
          ...manifest.styles.filter((p: unknown) => typeof p === 'string' && /^assets\/[\w.-]+\.css$/.test(p)).map((p: string) => `<link rel="preload" as="style" crossorigin href="/${p}">`)].join('');
      }
    } catch { /* Older builds still work without resource hints. */ }
    const bootstrap = opts.demoBootstrap;
    const data = bootstrap && bootstrap.schemaVersion === 1 && bootstrap.exportedAt === opts.demo.exportedAt && bootstrap.referenceTime === opts.demo.referenceTime
      ? `<script id="quotern-demo-bootstrap" type="application/json">${JSON.stringify(bootstrap).replace(/</g, '\\u003c')}</script>` : '';
    dashboardHead = preloads + demoHead + data;
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const sessionAction = url.split('?')[0]!.replace(/\/$/, '') === SESSION_ACTIONS_ROUTE;
    if (opts.demo && !['GET', 'HEAD'].includes(req.method ?? 'GET')) {
      res.statusCode = 403; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, message: 'DEMO_READ_ONLY', data: null })); req.resume(); return;
    }

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
      const path = url.split('?')[0];
      serveStatic(opts.staticDir, req, res, path === '/' || path === '/dashboard' ? dashboardHead : demoHead);
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
