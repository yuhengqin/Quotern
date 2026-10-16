import { isAbsolute, join } from 'node:path';

export function resolveQuotaPreviewConfig(env: Record<string, string | undefined>, packaged: boolean): { url: string; userData: string } {
  if (packaged || env.QUOTERN_DEV_QUOTA_PREVIEW !== '1' || env.QUOTERN_DEV_ISOLATED !== '1') {
    throw new Error('额度 mock 仅支持隔离开发实例，请使用 pnpm dev:desktop:quota');
  }
  for (const key of ['QUOTERN_DATA_DIR', 'QUOTERN_CONFIG_HOME', 'QUOTERN_DESKTOP_USER_DATA']) {
    if (!env[key] || !isAbsolute(env[key]!)) throw new Error(`额度 mock 需要独立绝对目录 ${key}`);
  }
  const url = new URL(env.QUOTERN_QUOTA_PREVIEW_URL || 'http://127.0.0.1:5173/');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.hash) {
    throw new Error('额度 mock 地址必须是无凭据的本机 HTTP 根地址');
  }
  url.searchParams.set('scene', 'mixed');
  return { url: url.href, userData: join(env.QUOTERN_DESKTOP_USER_DATA!, 'quota-preview') };
}
