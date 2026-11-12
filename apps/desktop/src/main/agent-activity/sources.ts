import { listClaudeProjectFiles, listCodexRolloutFiles, listDshSessionFiles } from 'quotern-core';
import type { ActivityRoot } from './monitor.js';

/** Reuse the public Core finders, including its configured multi-directory rules. */
export async function discoverAgentActivityRoots(): Promise<ActivityRoot[]> {
  const results = await Promise.allSettled([listCodexRolloutFiles(), listClaudeProjectFiles(), Promise.resolve().then(() => listDshSessionFiles())]);
  const sources = ['codex', 'claude', 'dsh'];
  return results.flatMap((result, index) => result.status === 'fulfilled' ? result.value.filter(file => file.endsWith('.jsonl')).map(file => ({ source: sources[index]!, path: file })) : []);
}
