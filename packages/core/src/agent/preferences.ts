import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lock } from 'proper-lockfile';

export const AGENT_FEATURES = ['quotaHints', 'tokenSaver', 'beginner', 'handoff', 'claudePane', 'glossary', 'claudeWindowStart', 'codexWindowStart'] as const;
export type AgentFeature = typeof AGENT_FEATURES[number];
export type AgentPreferences = Record<AgentFeature, boolean>;
export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = { quotaHints: false, tokenSaver: false, beginner: false, handoff: false, claudePane: false, glossary: false, claudeWindowStart: false, codexWindowStart: false };
export const agentDirectory = (dataDir: string) => join(dataDir, 'integrations');
export async function readAgentJson<T>(path: string, fallback: T, maxBytes = 1024 * 1024): Promise<T> {
  try {
    const value = await readFile(path);
    if (value.length > maxBytes) throw new Error('AGENT_FILE_TOO_LARGE');
    return JSON.parse(value.toString('utf8')) as T;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('AGENT_INVALID_CONFIG'); }
}
export async function writeAgentJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
export async function agentTransaction<T>(path: string, update: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await lock(path, { realpath: false, retries: { retries: 8, minTimeout: 30, maxTimeout: 150 }, stale: 30000 });
  try { return await update(); } finally { await release(); }
}
export async function readAgentPreferences(dataDir: string): Promise<AgentPreferences> {
  const stored = await readAgentJson<Record<string, unknown>>(join(agentDirectory(dataDir), 'preferences.json'), {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('AGENT_INVALID_CONFIG');
  return Object.fromEntries(AGENT_FEATURES.map(key => [key, stored[key] === true])) as AgentPreferences;
}
export async function patchAgentPreferences(dataDir: string, patch: unknown): Promise<AgentPreferences> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !AGENT_FEATURES.includes(key as AgentFeature) || typeof value !== 'boolean')) throw new Error('AGENT_INVALID_PREFERENCE');
  const path = join(agentDirectory(dataDir), 'preferences.json');
  return agentTransaction(path, async () => {
    const preferences = { ...await readAgentPreferences(dataDir), ...patch };
    await writeAgentJson(path, preferences);
    return preferences;
  });
}
