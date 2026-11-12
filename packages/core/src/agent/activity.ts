import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentDirectory, readAgentPreferences, readAgentJson } from './preferences.js';

export interface AgentActivity {
  source: 'claude' | 'codex'; sessionId: string; project: string; tool: string | null;
  state: 'started' | 'working' | 'tool-running' | 'tool-result' | 'tool-error' | 'approval-requested' | 'turn-ended' | 'ended';
  startedAt: number; observedAt: number; stale?: boolean;
}
/** Also embedded in the local hook. Persist metadata only, never tool inputs or responses. */
export function reduceAgentActivity(previous: AgentActivity | null, input: Record<string, unknown>, source: 'claude' | 'codex', now: number): AgentActivity | null {
  const states: Record<string, AgentActivity['state']> = { SessionStart: 'started', UserPromptSubmit: 'working', PreToolUse: 'tool-running', PostToolUse: 'tool-result', PostToolUseFailure: 'tool-error', PermissionRequest: 'approval-requested', Stop: 'turn-ended', SessionEnd: 'ended' };
  const state = states[String(input.hook_event_name)];
  if (!state || typeof input.session_id !== 'string' || !input.session_id || input.session_id.length > 256 || /[\x00-\x1f]/.test(input.session_id)) return null;
  const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, max) : '';
  const same = previous?.source === source && previous.sessionId === input.session_id && previous.observedAt <= now;
  const project = typeof input.cwd === 'string' ? input.cwd.split(/[\\/]/).filter(Boolean).at(-1) : '';
  return { source, sessionId: input.session_id, state, project: clean(project, 100) || (same ? previous!.project : ''),
    tool: ['tool-running', 'tool-result', 'tool-error', 'approval-requested'].includes(state) ? clean(input.tool_name, 80) || null : null,
    startedAt: same && !['SessionStart', 'UserPromptSubmit'].includes(String(input.hook_event_name)) && Number.isFinite(previous!.startedAt) ? previous!.startedAt : now, observedAt: now };
}

export async function readAgentActivities(dataDir: string, now = Date.now() / 1000): Promise<AgentActivity[]> {
  if (!(await readAgentPreferences(dataDir)).claudePane) return [];
  const root = join(agentDirectory(dataDir), 'observations');
  const recent = await readAgentJson<string[] | null>(join(root, 'recent.json'), null).catch(() => null);
  const files = Array.isArray(recent) ? [...new Set(recent.filter(id => /^[a-f0-9]{64}$/.test(id)))].slice(-512).map(id => id + '.json')
    : (await Promise.all((await readdir(root).catch(() => [])).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => ({ name, at: await stat(join(root, name)).then(value => value.mtimeMs).catch(() => 0) })))).sort((a, b) => b.at - a.at).slice(0, 512).map(row => row.name);
  const rows: AgentActivity[] = [];
  for (const name of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, 512)) {
    try {
      const file = join(root, name); if ((await stat(file)).size > 4096) continue;
      const row = JSON.parse(await readFile(file, 'utf8')) as AgentActivity;
      if (!['claude', 'codex'].includes(row.source) || typeof row.sessionId !== 'string' || !['started', 'working', 'tool-running', 'tool-result', 'tool-error', 'approval-requested', 'turn-ended', 'ended'].includes(row.state) || !Number.isFinite(row.observedAt) || row.observedAt > now + 60 || row.observedAt < now - 86400) continue;
      const safe = reduceAgentActivity(null, { session_id: row.sessionId, hook_event_name: 'SessionStart', cwd: row.project }, row.source, row.observedAt);
      if (!safe) continue;
      rows.push({ ...safe, state: row.state, tool: typeof row.tool === 'string' ? row.tool.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 80) : null,
        startedAt: Number.isFinite(row.startedAt) && row.startedAt <= row.observedAt && row.startedAt >= row.observedAt - 86400 ? row.startedAt : row.observedAt, stale: now - row.observedAt > 120 });
    } catch { /* A partial or old observation is unavailable, never an active process. */ }
  }
  return rows.sort((a, b) => b.observedAt - a.observedAt).slice(0, 32);
}
