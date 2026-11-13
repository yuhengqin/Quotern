import { applyPricingSnapshot, BucketStore, createLocalApiApp, type TudConfig } from 'quotern-core';
import { isSessionAnalysisRequest, type AnalysisRequest, type AnalysisResult } from './session-analysis-protocol';

/** Lives only in the analysis process. The app and its range caches survive requests. */
export class SessionAnalysisService {
  private readonly buckets = new BucketStore();
  private app: ReturnType<typeof createLocalApiApp> | null = null;
  private dataDir = '';
  private config!: TudConfig;
  private quotaState: AnalysisRequest['snapshot']['quotaState'] = null;
  private quotaHistory: AnalysisRequest['snapshot']['quotaHistory'] = null;
  private quotaHistoryKey: string | undefined;
  private revision = -1;
  private collectSince = '';
  private pricingFingerprint: string | null = null;

  async request(request: AnalysisRequest): Promise<AnalysisResult> {
    if (!isSessionAnalysisRequest(request.url, request.init?.method)) throw new Error('invalid session analysis request');
    const snapshot = request.snapshot;
    if (this.app && this.dataDir !== snapshot.dataDir) throw new Error('session analysis data directory changed');
    if (this.revision !== snapshot.bucketRevision || this.collectSince !== snapshot.collectSince) {
      if (!snapshot.rows) throw new Error('session analysis bucket snapshot missing');
      this.buckets.replace(snapshot.rows, [], snapshot.collectSince);
      this.revision = snapshot.bucketRevision; this.collectSince = snapshot.collectSince;
    }
    if (this.pricingFingerprint !== snapshot.pricingFingerprint) {
      if (!snapshot.pricing) throw new Error('session analysis pricing snapshot missing');
      applyPricingSnapshot(snapshot.pricing); this.pricingFingerprint = snapshot.pricingFingerprint;
    }
    this.config = { ...snapshot.config, statsSince: snapshot.collectSince, localCollectSince: snapshot.collectSince };
    this.quotaState = snapshot.quotaState;
    this.quotaHistory = snapshot.quotaHistory;
    this.quotaHistoryKey = snapshot.quotaHistoryKey ?? snapshot.quotaHistory?.providerId;
    if (!this.app) {
      this.dataDir = snapshot.dataDir;
      this.app = createLocalApiApp({ dataDir: this.dataDir, getConfig: () => this.config, bucketStore: this.buckets, getQuotaState: () => this.quotaState,
        getQuotaHistory: id => this.quotaHistoryKey === id ? this.quotaHistory ?? null : null });
    }
    const response = await this.app.request(request.url, { method: 'GET', headers: request.init?.headers });
    const text = await response.text();
    let body: unknown = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { success: false, message: text, data: null }; } }
    return { status: response.status, body };
  }
}
