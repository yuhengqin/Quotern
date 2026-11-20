import type { PricingSnapshot, QueueBucket, TudConfig } from 'quotern-core';
import type { QuotaState } from '../shared/quota';

const ROUTES = new Set(['/functions/tud-session-activity', '/functions/tud-session-list', '/functions/tud-session-detail', '/functions/tud-performance', '/functions/tud-usage-sessions']);
export interface AnalysisRequestInit { method?: string; headers?: Record<string, string>; body?: string }
export interface AnalysisContext {
  dataDir: string;
  config: TudConfig;
  bucketRevision: number;
  collectSince: string;
  rows: QueueBucket[];
  pricingFingerprint: string;
  pricing: PricingSnapshot;
  quotaState: QuotaState | null;
}
export type AnalysisSnapshot = Omit<AnalysisContext, 'rows' | 'pricing'> & { rows?: QueueBucket[]; pricing?: PricingSnapshot };
export interface AnalysisResult { status: number; body: unknown }
export type AnalysisRequest = { type: 'request'; id: number; url: string; init?: AnalysisRequestInit; snapshot: AnalysisSnapshot };
export type AnalysisResponse = { type: 'ready'; pid: number } | { type: 'result'; id: number; result: AnalysisResult } | { type: 'error'; id: number; error: string };

/** Exact read-only routes: never give the analysis process an admin/write path. */
export function isSessionAnalysisRequest(url: string, method = 'GET'): boolean {
  try { return method.toUpperCase() === 'GET' && ROUTES.has(new URL(url, 'http://tud.local').pathname); }
  catch { return false; }
}
