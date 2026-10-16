import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function exists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

/** Return a reason to retain the lease, or null when every chain is excluded. */
export function windowsProcessEvidence(record, rows) {
  if (!Array.isArray(rows) || !rows.length) return '系统进程快照为空';
  const cutoff = Date.parse(record.startedAt);
  if (!Number.isFinite(cutoff) || cutoff > Date.now()) return '会话开始时间无效';
  const processes = new Map();
  for (const row of rows) {
    // These two kernel processes cannot be descendants of a development launcher.
    if (row.pid === 0 || row.pid === 4) continue;
    const born = Date.parse(row.startedAt);
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0 || !Number.isSafeInteger(row.parentPid)
      || row.parentPid < 0 || !Number.isFinite(born) || processes.has(row.pid)) return '系统进程信息不完整';
    processes.set(row.pid, { ...row, born });
  }
  const known = new Set([record.pid, ...record.children.map((child) => child.pid)]);
  for (const pid of known) if (processes.has(pid)) return `原会话或子进程 PID ${pid} 仍存在`;
  for (const row of processes.values()) {
    if (row.born < cutoff) continue;
    let current = row;
    const seen = new Set();
    while (current.born >= cutoff) {
      if (known.has(current.parentPid)) return `发现原会话后代 PID ${row.pid}`;
      if (seen.has(current.pid)) return '进程祖先链存在循环';
      seen.add(current.pid);
      const parent = processes.get(current.parentPid);
      if (!parent || parent.born > current.born) return `PID ${row.pid} 的祖先已退出或 PID 已复用，无法排除残留后代`;
      current = parent;
    }
  }
  return null;
}

async function windowsSnapshot() {
  const script = `$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process | ForEach-Object {
    [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId;
      startedAt = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } }
  }) | ConvertTo-Json -Compress`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
  });
  return JSON.parse(stdout.trim());
}

export async function sessionEndEvidence(record) {
  if (exists(record.pid)) return `原会话 PID ${record.pid} 仍存在`;
  for (const child of record.children) {
    if (exists(child.pid)) return `子进程 PID ${child.pid} 仍存在`;
  }
  // close() writes stopped only after the supervisor has confirmed tree cleanup.
  if (record.status === 'stopped' && Number.isFinite(Date.parse(record.stoppedAt))
    && Date.parse(record.stoppedAt) >= Date.parse(record.startedAt)) return null;
  if (process.platform !== 'win32') return '异常会话的后代记录可能不完整，请人工核对进程组';
  try {
    // Two censuses reduce exit/spawn races. Any ambiguity in either one blocks recovery.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reason = windowsProcessEvidence(record, await windowsSnapshot());
      if (reason) return reason;
    }
  } catch { return '无法完整检查系统进程，保留原锁'; }
  // Do not treat PID reuse during inspection as permission to recover.
  if (exists(record.pid) || record.children.some((child) => exists(child.pid))) return '检查期间原会话或子进程 PID 重新出现';
  return null;
}
