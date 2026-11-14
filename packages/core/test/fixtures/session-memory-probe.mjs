import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readSessionHistory } from '../../dist-test/src/session-collector.js';
import { SessionQueryService } from '../../dist-test/src/session-query.js';
import { BucketStore } from '../../dist-test/src/server/state.js';

const dataDir = process.argv[2];
await mkdir(join(dataDir, 'sessions'), { recursive: true });
const evidence = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [String(i), {
  source: 'claude', sessionId: 'fixture', id: String(i), kind: 'metadata', timestamp: '2026-10-16T04:00:00Z',
  agentNickname: String(i) + ':'.repeat(4096),
}]));
const file = { complete: true, size: 0, mtimeMs: 0, ino: 1, offset: 0, guard: '', context: { sessionId: 'fixture' }, messages: {}, timings: {}, titles: {},
  observations: { usage: { source: 'claude', sessionId: 'fixture', id: 'usage', timestamp: '2026-10-16T04:00:00Z', model: 'fixture', tokens: 2, usageKnown: true,
    costUsd: null, costKind: 'unknown', billing: { service: 'unknown', mode: 'unknown', accountRef: null, evidence: 'unknown' } } }, evidence };
const path = join(dataDir, 'sessions', 'claude.json');
const queries = new SessionQueryService({ dataDir, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z' }) }, readSessionHistory);
const query = { days: 7, bounds: { fromDate: '2026-10-16', toDate: '2026-10-16' } };
const samples = [];
for (let generation = 0; generation < 16; generation++) {
  file.size = generation;
  await writeFile(path, JSON.stringify({ version: 12, source: 'claude', complete: true, files: { fixture: file } }));
  const result = await queries.full(query);
  if (result.sessions.length !== 1 || result.sessions[0].tokens !== 2) throw new Error('history result changed');
  await new Promise(resolve => setImmediate(resolve));
  global.gc();
  samples.push(process.memoryUsage().heapUsed);
}
console.log(JSON.stringify({ first: samples[0], last: samples.at(-1), samples }));
