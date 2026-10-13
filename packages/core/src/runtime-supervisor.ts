import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

import { DEFAULT_DATA_DIR, heartbeatPath } from './paths.js';
import {
  argsMatchRuntimeKind,
  clearPid,
  isPidAlive,
  readRuntimeOwner,
  stopPid,
  type RuntimeKind,
} from './runtime-pid.js';

/** Desktop watchdog tick while healthy; heartbeat is overwritten on each tick. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** ~3 missed ticks (or a dead pid) means the owner is hung. */
export const HEARTBEAT_STALE_MS = 90_000;

export interface RuntimeHeartbeat {
  pid: number;
  kind: RuntimeKind;
  at: number;
}

export interface ProcessSnapshot {
  pid: number;
  args: string;
  ppid: number | null;
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseUnixProcessTable(out: string): ProcessSnapshot[] {
  const rows: ProcessSnapshot[] = [];
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const args = match[3]?.trim() ?? '';
    if (!Number.isInteger(pid) || pid <= 0 || !args) continue;
    rows.push({
      pid,
      ppid: Number.isInteger(ppid) && ppid > 0 ? ppid : null,
      args,
    });
  }
  return rows;
}

function parseWindowsProcessList(out: string): ProcessSnapshot[] {
  const rows: ProcessSnapshot[] = [];
  const blocks = out.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const pidMatch = /ProcessId\s*[:=]\s*(\d+)/i.exec(block);
    if (!pidMatch) continue;
    const pid = Number(pidMatch[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const cmdMatch = /CommandLine\s*[:=]\s*(.*)/i.exec(block);
    const parentMatch = /ParentProcessId\s*[:=]\s*(\d+)/i.exec(block);
    const args = collapseWs(cmdMatch?.[1] ?? '');
    if (!args) continue;
    const ppid = parentMatch ? Number(parentMatch[1]) : null;
    rows.push({
      pid,
      args,
      ppid: ppid != null && Number.isInteger(ppid) && ppid > 0 ? ppid : null,
    });
  }
  return rows;
}

function listWindowsProcessSnapshots(): ProcessSnapshot[] {
  try {
    const out = execFileSync(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId,CommandLine', '/FORMAT:LIST'],
      {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const rows = parseWindowsProcessList(out);
    if (rows.length > 0) return rows;
  } catch {
    // wmic is missing on some Win11 builds; fall through to CIM.
  }
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | Format-List',
      ],
      {
        encoding: 'utf-8',
        timeout: 8_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    return parseWindowsProcessList(out);
  } catch {
    return [];
  }
}

/** Snapshot of live processes (pid / ppid / command line). */
export function listProcessSnapshots(): ProcessSnapshot[] {
  try {
    if (process.platform === 'win32') {
      return listWindowsProcessSnapshots();
    }
    const out = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,args='], {
      encoding: 'utf-8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    });
    return parseUnixProcessTable(out);
  } catch {
    return [];
  }
}

function sessionRootPid(
  selfPid: number,
  byPid: Map<number, ProcessSnapshot>,
): number {
  let current = selfPid;
  for (let i = 0; i < 16; i += 1) {
    const row = byPid.get(current);
    if (!row?.ppid || row.ppid <= 1) return current;
    current = row.ppid;
  }
  return selfPid;
}

function descendantPids(
  rootPid: number,
  snapshots: ProcessSnapshot[],
): Set<number> {
  const children = new Map<number, number[]>();
  for (const row of snapshots) {
    if (row.ppid == null) continue;
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  const out = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    for (const child of children.get(pid) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

function looksLikeDevTooling(args: string): boolean {
  const lower = args.toLowerCase();
  return (
    lower.includes('electron-vite') ||
    lower.includes('/vite.js') ||
    lower.includes('\\vite.js') ||
    lower.includes('vite/bin/vite')
  );
}

/**
 * Pids that must not be evicted: this process session (ancestors + descendants)
 * plus any electron-vite / Vite tooling. On macOS Electron can reparent under
 * launchd, so Vite is often a sibling rather than a child — never kill it.
 */
export function protectedSessionPids(
  snapshots: ProcessSnapshot[],
  selfPid = process.pid,
): Set<number> {
  const byPid = new Map(snapshots.map((row) => [row.pid, row]));
  const out = descendantPids(sessionRootPid(selfPid, byPid), snapshots);
  for (const row of snapshots) {
    if (!looksLikeDevTooling(row.args)) continue;
    for (const pid of descendantPids(row.pid, snapshots)) out.add(pid);
  }
  return out;
}

export function listRuntimePids(kind: RuntimeKind): number[] {
  const seen = new Set<number>();
  for (const row of listProcessSnapshots()) {
    if (!argsMatchRuntimeKind(row.args, kind)) continue;
    seen.add(row.pid);
  }
  return [...seen];
}

/**
 * Stop every live process that looks like `kind`, except this process session
 * (ancestors + their descendants, so Vite / electron-vite are not killed).
 * Clears `tud.pid` when it pointed at a killed pid.
 */
export async function evictRuntimeKind(
  kind: RuntimeKind,
  opts?: { exceptPid?: number; dataDir?: string },
): Promise<number[]> {
  const exceptPid = opts?.exceptPid ?? process.pid;
  const dataDir = opts?.dataDir ?? DEFAULT_DATA_DIR;
  const snapshots = listProcessSnapshots();
  const protectedPids = protectedSessionPids(snapshots, exceptPid);
  const stopped: number[] = [];

  for (const row of snapshots) {
    if (row.pid === exceptPid || protectedPids.has(row.pid)) continue;
    if (!argsMatchRuntimeKind(row.args, kind)) continue;
    if (await stopPid(row.pid)) stopped.push(row.pid);
  }

  const owner = await readRuntimeOwner(dataDir);
  if (
    owner != null &&
    owner.pid !== exceptPid &&
    !protectedPids.has(owner.pid) &&
    (owner.kind === kind || !isPidAlive(owner.pid))
  ) {
    await clearPid(dataDir);
  }

  return stopped;
}

export async function touchRuntimeHeartbeat(
  owner: { pid?: number; kind: RuntimeKind },
  dataDir = DEFAULT_DATA_DIR,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const payload: RuntimeHeartbeat = {
    pid: owner.pid ?? process.pid,
    kind: owner.kind,
    at: Date.now(),
  };
  await writeFile(heartbeatPath(dataDir), `${JSON.stringify(payload)}\n`, 'utf8');
}

export async function readRuntimeHeartbeat(
  dataDir = DEFAULT_DATA_DIR,
): Promise<RuntimeHeartbeat | null> {
  const path = heartbeatPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as {
      pid?: unknown;
      kind?: unknown;
      at?: unknown;
    };
    const pid = Number(parsed.pid);
    const at = Number(parsed.at);
    if (
      !Number.isInteger(pid) ||
      pid <= 0 ||
      (parsed.kind !== 'cli' && parsed.kind !== 'desktop') ||
      !Number.isFinite(at) ||
      at <= 0
    ) {
      return null;
    }
    return { pid, kind: parsed.kind, at };
  } catch {
    return null;
  }
}

export async function clearRuntimeHeartbeat(
  dataDir = DEFAULT_DATA_DIR,
): Promise<void> {
  const path = heartbeatPath(dataDir);
  if (!existsSync(path)) return;
  try {
    await unlink(path);
  } catch {
    // ignore
  }
}

export function isHeartbeatFresh(
  heartbeat: RuntimeHeartbeat | null,
  now = Date.now(),
  staleMs = HEARTBEAT_STALE_MS,
): boolean {
  if (heartbeat == null) return false;
  if (now - heartbeat.at > staleMs) return false;
  if (!isPidAlive(heartbeat.pid)) return false;
  return true;
}
