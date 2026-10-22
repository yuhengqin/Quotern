import type { Hono } from 'hono';
import type { DemoMetadata } from './types.js';

export interface DemoBootstrap {
  schemaVersion: 1;
  exportedAt: string;
  referenceTime: string;
  responses: Record<string, { success: true; data: unknown }>;
}

/** Reuse read contracts once, before listening. Never embed raw history or failed responses. */
export async function prepareDemoBootstrap(app: Hono, demo: DemoMetadata): Promise<DemoBootstrap> {
  const paths = ['config', 'achievements', 'account-usage-summary', 'sync-status', 'usage-daily?days=365',
    'usage-hourly?days=7', 'usage-model-breakdown?days=7', 'usage-sessions?days=7',
    'usage-report?period=summary&days=7', 'usage-trend?granularity=daily&days=7', 'session-activity?days=7&preview=6'];
  const responses: DemoBootstrap['responses'] = {};
  for (const suffix of paths) {
    const path = `/functions/tud-${suffix}`;
    const response = await app.request(path);
    const body = await response.json() as { success: boolean; data: unknown };
    if (!response.ok || body.success !== true || body.data == null) throw new Error(`演示首页预生成失败：${path}`);
    responses[path] = { success: true, data: body.data };
  }
  return { schemaVersion: 1, exportedAt: demo.exportedAt, referenceTime: demo.referenceTime, responses };
}
