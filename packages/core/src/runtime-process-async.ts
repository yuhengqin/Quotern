import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
interface ProcessIdentity { args: string | null; startedAt: string | null }
const cache = new Map<number, { at: number; value: ProcessIdentity }>();
const pending = new Map<number, Promise<ProcessIdentity>>();
let selfStartedAt: string | null = null;
const clean = (value: unknown): string | null => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : null;

async function output(command: string, args: string[], timeout: number): Promise<string | null> {
  try {
    return (await execute(command, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })).stdout;
  } catch { return null; }
}

async function inspect(pid: number): Promise<ProcessIdentity> {
  if (process.platform !== 'win32') {
    const [args, startedAt] = await Promise.all([output('ps', ['-ww', '-p', String(pid), '-o', 'args='], 2000), output('ps', ['-ww', '-p', String(pid), '-o', 'lstart='], 2000)]);
    return { args: clean(args), startedAt: clean(startedAt) };
  }
  // One CIM snapshot gives both fields without two cold PowerShell starts.
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($p) { $start = $null; if ($p.CreationDate) { $start = $p.CreationDate.ToUniversalTime().ToString('o') }; @{ CommandLine = $p.CommandLine; CreationDate = $start } | ConvertTo-Json -Compress }`;
  const raw = await output('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 20000);
  if (raw) try {
    const value = JSON.parse(raw) as { CommandLine?: unknown; CreationDate?: unknown };
    return { args: clean(value.CommandLine), startedAt: clean(value.CreationDate) };
  } catch { /* WMIC remains a compatibility fallback. */ }
  const fallback = await output('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine,CreationDate', '/value'], 3000);
  return { args: clean(fallback?.match(/^CommandLine=(.*)$/m)?.[1]), startedAt: clean(fallback?.match(/^CreationDate=(.*)$/m)?.[1]) };
}

/** Cache only successful, short-lived probes; concurrent callers share one query. */
export async function readProcessIdentity(pid: number): Promise<ProcessIdentity> {
  if (!Number.isInteger(pid) || pid <= 0) return { args: null, startedAt: null };
  const hit = cache.get(pid);
  if (hit && Date.now() - hit.at < 2000) return hit.value;
  let operation = pending.get(pid);
  if (!operation) {
    operation = inspect(pid).then(value => {
      if (value.args || value.startedAt) {
        cache.delete(pid); cache.set(pid, { at: Date.now(), value });
        while (cache.size > 256) cache.delete(cache.keys().next().value!);
      }
      if (pid === process.pid && value.startedAt) selfStartedAt = value.startedAt;
      return value;
    }).finally(() => pending.delete(pid));
    pending.set(pid, operation);
  }
  return operation;
}

/** The running process cannot reuse its own PID during its lifetime. */
export function isCurrentProcessStart(startedAt: string | undefined): boolean {
  return Boolean(startedAt && selfStartedAt && startedAt === selfStartedAt);
}

export function resetAsyncProcessIdentityCache(): void { cache.clear(); selfStartedAt = null; }
