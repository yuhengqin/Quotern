import { readFile, lstat } from 'node:fs/promises';
import { jobEvidencePath } from './dev-windows-job.mjs';

function exists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export async function sessionEndEvidence(record) {
  if (exists(record.pid)) return `原会话 PID ${record.pid} 仍存在`;
  for (const child of record.children) {
    if (exists(child.pid)) return `子进程 PID ${child.pid} 仍存在`;
  }
  // Legacy normal closes already confirmed cleanup. Tracked sessions always need
  // their receipt if a crash interrupted lease release, even with status stopped.
  if (!record.processTracker && record.status === 'stopped' && Number.isFinite(Date.parse(record.stoppedAt))
    && Date.parse(record.stoppedAt) >= Date.parse(record.startedAt)) return null;
  if (process.platform !== 'win32') return '异常会话的后代记录可能不完整，请人工核对进程组';
  const tracker = record.processTracker;
  if (!tracker || tracker.kind !== 'windows-job-v1' || tracker.jobName !== `Local\\QuoternDev-${record.sessionId}`
    || typeof tracker.proofToken !== 'string' || !/^[0-9a-f-]{36}$/i.test(tracker.proofToken)) {
    return '旧会话缺少 Windows Job 进程归属记录，需要人工核验恢复';
  }
  try {
    const path = jobEvidencePath(record);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return 'Windows Job 退出凭据不是普通文件';
    const proof = JSON.parse(await readFile(path, 'utf8'));
    if (proof.status !== 'ended' || ['sessionId', 'mode', 'pid', 'worktree', 'startedAt'].some((key) => proof[key] !== record[key])
      || ['kind', 'jobName', 'proofToken'].some((key) => proof[key] !== tracker[key])) return 'Windows Job 退出凭据与原会话不匹配';
  } catch (error) {
    return error.code === 'ENOENT' ? 'Windows Job 尚无全部后代退出凭据，可能仍有后代进程或监视进程异常'
      : 'Windows Job 退出凭据无法读取，保留原锁';
  }
  if (exists(record.pid) || record.children.some((child) => exists(child.pid))) return '检查期间原会话或子进程 PID 重新出现';
  return null;
}
