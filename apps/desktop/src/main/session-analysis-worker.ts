import { SessionAnalysisService } from './session-analysis-service';
import type { AnalysisRequest, AnalysisResponse } from './session-analysis-protocol';
import { restoreNativeTrapHandler } from './native-crash-signals';
import { measureCpuPhase, syncLogPath } from 'quotern-core';

restoreNativeTrapHandler();
process.title = 'tud-session-analysis';
interface ParentPort { on(event: 'message', listener: (event: { data: AnalysisRequest }) => void): void; postMessage(message: AnalysisResponse): void }
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parent) throw new Error('session analysis requires process.parentPort');
const service = new SessionAnalysisService();
let queue = Promise.resolve();
// A request sees one coherent bucket/config/pricing snapshot, even across awaits.
parent.on('message', ({ data }) => {
  if (data?.type !== 'request') return;
  queue = queue.then(async () => {
    try {
      const details = { role: 'session-analysis', route: new URL(data.url).pathname, status: 0 };
      const result = await measureCpuPhase(syncLogPath(data.snapshot.dataDir), 'session_query', details, async () => {
        const response = await service.request(data); details.status = response.status; return response;
      });
      parent.postMessage({ type: 'result', id: data.id, result });
    }
    catch (error) { parent.postMessage({ type: 'error', id: data.id, error: error instanceof Error ? error.message : String(error) }); }
  });
});
parent.postMessage({ type: 'ready', pid: process.pid });
