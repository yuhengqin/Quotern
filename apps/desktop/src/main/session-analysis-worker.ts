import { SessionAnalysisService } from './session-analysis-service';
import type { AnalysisRequest, AnalysisResponse } from './session-analysis-protocol';
import { restoreNativeTrapHandler } from './native-crash-signals';
import { measureCpuPhase, syncLogPath } from 'quotern-core';

restoreNativeTrapHandler();
process.title = 'tud-session-analysis';
if (!process.send) throw new Error('session analysis requires process IPC');
const post = (message: AnalysisResponse) => process.send!(message);
const service = new SessionAnalysisService();
let queue = Promise.resolve();
// A request sees one coherent bucket/config/pricing snapshot, even across awaits.
process.on('disconnect', () => process.exit(0));
process.on('message', (message) => {
  const data = message as AnalysisRequest;
  if (data?.type !== 'request') return;
  queue = queue.then(async () => {
    try {
      const details = { role: 'session-analysis', route: new URL(data.url).pathname, status: 0 };
      const result = await measureCpuPhase(syncLogPath(data.snapshot.dataDir), 'session_query', details, async () => {
        const response = await service.request(data); details.status = response.status; return response;
      });
      post({ type: 'result', id: data.id, result });
    }
    catch (error) { post({ type: 'error', id: data.id, error: error instanceof Error ? error.message : String(error) }); }
  });
});
post({ type: 'ready', pid: process.pid });
