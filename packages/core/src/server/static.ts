import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function resolveStaticPath(rootDir: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  let rel = decoded;
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(join(rootDir, rel));
  if (!safe.startsWith(normalize(rootDir))) return null;
  return safe;
}

export function serveStatic(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  htmlHead?: string,
): boolean {
  if (!existsSync(rootDir)) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Dashboard not built. Run: pnpm --filter quotern-dashboard build');
    return true;
  }

  const filePath = resolveStaticPath(rootDir, req.url ?? '/');
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return true;
  }

  let target = filePath;
  if (!existsSync(target) || !statSync(target).isFile()) {
    target = join(rootDir, 'index.html');
    if (!existsSync(target)) {
      res.statusCode = 404;
      res.end('Not found');
      return true;
    }
  }

  const ext = extname(target);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  if (htmlHead && ext === '.html') {
    res.setHeader('Cache-Control', 'no-store');
    const html = readFileSync(target, 'utf8').replace(/<head(?:\s[^>]*)?>/i, match => match + htmlHead);
    res.end(req.method === 'HEAD' ? undefined : html);
    return true;
  }
  createReadStream(target).pipe(res);
  return true;
}

export function isApiPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0] ?? '';
  return path.startsWith('/functions/') || path.startsWith('/api/') || path === '/health';
}
