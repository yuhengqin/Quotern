import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { guiCliEnvironment } from './cli-runtime.js';
import { runClaudeCommand } from './claude-subscription.js';
import { recordQuotaAttempt } from './quota-fetch-state.js';

type Window = { usedPercent: number; resetsAt: number | null };
interface Snapshot { status: string; message: string | null; fetchedAt: number | null; stale: boolean; planLabel: string | null; fiveHour: Window | null; weekly: Window | null }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
function window(value: unknown): Window | null {
  const row = record(value);
  if (typeof row.usedPercent !== 'number' || !Number.isFinite(row.usedPercent) || row.usedPercent < 0) return null;
  const reset = positive(row.resetsAtMs);
  return { usedPercent: row.usedPercent, resetsAt: reset === null ? null : reset / 1000 };
}
export function createMuseSubscriptionReader(deps: { execute(args: readonly string[]): Promise<{ stdout: string; code: number | null }>; now?: () => number }) {
  return async (): Promise<Snapshot> => {
    const unavailable = (): Snapshot => ({ status: 'temporarily-unavailable', message: 'Muse usage --json 未提供可用额度', fetchedAt: null, stale: false, planLabel: null, fiveHour: null, weekly: null });
    try {
      const result = await deps.execute(['usage', '--json']);
      if (result.code !== 0 || result.stdout.length > 256 * 1024) return unavailable();
      const raw = record(JSON.parse(result.stdout)), allowance = record(raw.allowance);
      const fiveHour = window(allowance.window), weekly = window(allowance.weekly);
      if (!fiveHour && !weekly) return unavailable();
      const now = (deps.now ?? Date.now)(), observed = positive(allowance.asOfMs);
      // Querying a cached CLI response cannot establish its observation time.
      const fetchedAt = observed !== null && observed <= now + 60000 ? observed / 1000 : null;
      recordQuotaAttempt({ stage: 'cli', outcome: 'success', code: null });
      return { status: 'ok', message: null, fetchedAt, stale: fetchedAt === null || now / 1000 - fetchedAt > 900,
        planLabel: typeof raw.tier === 'string' ? raw.tier.slice(0, 80) : null, fiveHour, weekly };
    } catch { recordQuotaAttempt({ stage: 'cli', outcome: 'failure', code: 'COMMAND_FAILED' }); return unavailable(); }
  };
}
export function createDefaultMuseSubscriptionReader() {
  return createMuseSubscriptionReader({ execute: async args => {
    const env = guiCliEnvironment();
    const candidates = process.platform === 'win32'
      ? [join(homedir(), '.local', 'bin', 'muse.exe'), join(env.APPDATA ?? '', 'npm', 'muse.cmd')]
      : [join(homedir(), '.local', 'bin', 'muse'), '/usr/local/bin/muse', '/opt/homebrew/bin/muse'];
    const command = env.MUSE_CLI_PATH?.trim() || candidates.find(path => existsSync(path)) || 'muse';
    const cwd = await mkdtemp(join(tmpdir(), 'quotern-muse-usage-'));
    try { return await runClaudeCommand(command, [...args], cwd, env, 10000); }
    finally { await rm(cwd, { recursive: true, force: true }); }
  } });
}
