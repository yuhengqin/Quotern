import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readRuntimeOwner } from '../runtime-pid.js';
import { findSessionExecutable } from '../session-actions.js';
import { CODEX_WINDOW_CONFIG, verifyWindowIdentity, windowCommand, stopWindowProcess } from './window-identity.js';
import { guiCliEnvironment } from '../quota/readers/cli-runtime.js';
import { quotaWindowPeriodSeconds, type QuotaState } from '../quota/shared/quota.js';
import { agentDirectory, agentTransaction, readAgentJson, readAgentPreferences, writeAgentJson } from './preferences.js';

export const WINDOW_START_PROMPT = 'Reply with OK only. Do not use tools.';
export const windowStartArguments = (provider: 'claude' | 'codex') => provider === 'claude'
  ? ['--safe-mode', '--setting-sources', '', '--no-session-persistence', '--max-turns', '1', '--tools', '', '-p', WINDOW_START_PROMPT]
  : ['exec', ...CODEX_WINDOW_CONFIG, '-c', 'model_provider="openai"', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', WINDOW_START_PROMPT];

/** Only a task-owned empty cwd and fixed arguments reach the local Agent CLI. */
async function prepareWindowStart(provider: 'claude' | 'codex', accountRef: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'quotern-window-'));
  const dispose = () => rm(cwd, { recursive: true, force: true }).catch(() => {});
  try {
    const env = guiCliEnvironment(), executable = await findSessionExecutable(provider, cwd, env);
    if (!executable) throw new Error('AGENT_CLI_UNAVAILABLE');
    if (!await verifyWindowIdentity(provider, accountRef, executable, cwd, env)) { await dispose(); return null; }
    const args = windowStartArguments(provider);
    const launch = windowCommand(executable, args, cwd, env);
    return { dispose, execute: () => new Promise<void>((resolve, reject) => {
      const child = spawn(launch.executable, launch.args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let bytes = 0, finished = false;
      const finish = (error?: Error) => {
        if (finished) return; finished = true; clearTimeout(timer);
        if (error) {
          void stopWindowProcess(child).then(() => reject(error));
        } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('AGENT_REQUEST_TIMEOUT')), 30000);
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 128 * 1024) finish(new Error('AGENT_REQUEST_OUTPUT_LIMIT')); });
      child.once('error', () => finish(new Error('AGENT_REQUEST_FAILED')));
      child.once('close', code => finish(code === 0 ? undefined : new Error('AGENT_REQUEST_FAILED')));
    }) };
  } catch { await dispose(); return null; }
}
interface WindowMemory { known: Record<string, { reset: number; at: number }>; attempted: Record<string, { at: number; outcome: 'attempted' | 'completed' | 'uncertain' }> }
export function createWindowStarter(dataDir: string, runtime: 'cli' | 'desktop', dependencies: {
  now?: () => number; isOwner?: () => Promise<boolean>; execute?: (provider: 'claude' | 'codex') => Promise<void>; isolated?: boolean;
} = {}) {
  const now = dependencies.now ?? (() => Date.now() / 1000);
  const owner = dependencies.isOwner ?? (async () => { const value = await readRuntimeOwner(dataDir); return value?.pid === process.pid && value.kind === runtime; });
  const file = join(agentDirectory(dataDir), 'window-start.json');
  let pending = false;
  return async (state: QuotaState) => {
    if (pending || (dependencies.isolated ?? process.env.QUOTERN_DEV_ISOLATED === '1') || !await owner()) return;
    pending = true;
    try {
      const prefs = await readAgentPreferences(dataDir);
      if (!prefs.claudeWindowStart && !prefs.codexWindowStart) return;
      await agentTransaction(file, async () => {
        const memory = await readAgentJson<WindowMemory>(file, { known: {}, attempted: {} });
        if (!memory.known || !memory.attempted) throw new Error('AGENT_INVALID_CONFIG');
        const stamp = now();
        for (const provider of ['claude', 'codex'] as const) {
          if (!prefs[`${provider}WindowStart`]) continue;
          const p = state.providers.find(item => item.id === provider);
          if (!p || p.status !== 'ready' || p.stale || p.refreshing || p.diagnostic?.code || p.provenance?.source !== 'native' || !p.provenance.identityVerified || !p.provenance.accountRef || p.fetchedAt === null || p.fetchedAt > stamp + 60 || p.fetchedAt < stamp - 900) continue;
          const windows = p.windows.filter(w => quotaWindowPeriodSeconds(w) === 18000 && !w.id.startsWith('feature:') && w.timeKind !== 'expiry' && !w.balance);
          if (windows.length !== 1) continue;
          const window = windows[0]!, reset = window.resetsAt;
          if (reset === null || !Number.isFinite(reset)) continue;
          const key = createHash('sha256').update(provider + ':' + p.provenance.accountRef).digest('hex');
          const previous = memory.known[key];
          if (reset > stamp && reset < stamp + 21600) { memory.known[key] = { reset, at: p.fetchedAt }; continue; }
          const attempt = `${key}:${reset}`;
          // Missing reset dates and stale values are not evidence of a new window.
          if (!previous || previous.reset !== reset || previous.at >= reset || reset > stamp || stamp - reset > 3600 || p.fetchedAt < reset || window.usedPercent !== 0 || memory.attempted[attempt]) continue;
          if (!await owner() || !(await readAgentPreferences(dataDir))[`${provider}WindowStart`]) continue;
          const prepared = dependencies.execute ? { execute: () => dependencies.execute!(provider), dispose: async () => {} } : await prepareWindowStart(provider, p.provenance.accountRef);
          if (!prepared) continue;
          try {
            if (!await owner() || !(await readAgentPreferences(dataDir))[`${provider}WindowStart`]) continue;
            memory.attempted[attempt] = { at: stamp, outcome: 'attempted' };
            await writeAgentJson(file, memory); // Persist BEFORE any request; crashes never cause a retry.
            try { await prepared.execute(); memory.attempted[attempt]!.outcome = 'completed'; }
            catch { memory.attempted[attempt]!.outcome = 'uncertain'; }
          } finally { await prepared.dispose(); }
          await writeAgentJson(file, memory);
        }
        memory.known = Object.fromEntries(Object.entries(memory.known).filter(([, value]) => value.at > stamp - 86400).slice(-100));
        memory.attempted = Object.fromEntries(Object.entries(memory.attempted).filter(([, value]) => value.at > stamp - 7 * 86400).slice(-200));
        await writeAgentJson(file, memory);
      });
    } finally { pending = false; }
  };
}
