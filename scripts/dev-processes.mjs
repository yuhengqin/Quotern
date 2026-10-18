import { readFile, lstat } from 'node:fs/promises';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { jobEvidencePath } from './dev-windows-job.mjs';

const POSIX_KIND = 'posix-pgroups-v1';
const identityKeys = ['sessionId', 'mode', 'pid', 'worktree', 'startedAt'];
function groupRecordPath(record) {
  if (!/^[a-z0-9-]+$/i.test(record.sessionId)) throw new Error('进程组会话 ID 无效');
  return join(record.worktree, '.quotern-dev/process-groups', `${record.sessionId}.json`);
}

/** A synchronous write-ahead journal closes the async child-list recording gap. */
export function createPosixGroupTracker(record) {
  const descriptor = { kind: POSIX_KIND, proofToken: randomUUID() };
  const path = groupRecordPath(record);
  mkdirSync(dirname(path), { recursive: true });
  let proof;
  function save(next) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(next), { flag: 'wx' });
      renameSync(tmp, path);
      proof = next;
    } finally { rmSync(tmp, { force: true }); }
  }
  save({ ...descriptor, ...Object.fromEntries(identityKeys.map(key => [key, record[key]])), pendingSpawn: false, pgids: [] });
  return {
    descriptor,
    beforeSpawn() {
      if (proof.pendingSpawn) throw new Error('上一进程组创建记录尚未完成');
      save({ ...proof, pendingSpawn: true });
    },
    afterSpawn(pid) {
      // A failed spawn has no PID. Keep pending so shutdown cannot certify it.
      if (!Number.isSafeInteger(pid) || pid <= 0) return;
      save({ ...proof, pgids: [...proof.pgids, pid], pendingSpawn: false });
    },
  };
}

function exists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export async function posixGroupEndEvidence(record) {
  const tracker = record.processTracker;
  if (!tracker || tracker.kind !== POSIX_KIND || typeof tracker.proofToken !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(tracker.proofToken)) return '缺少完整进程组记录，请人工核对旧会话';
  try {
    const path = groupRecordPath(record);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return '进程组记录不是普通文件';
    const proof = JSON.parse(await readFile(path, 'utf8'));
    if (identityKeys.some(key => proof[key] !== record[key]) || proof.kind !== tracker.kind || proof.proofToken !== tracker.proofToken
      || proof.pendingSpawn !== false || !Array.isArray(proof.pgids)
      || proof.pgids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)
      || new Set(proof.pgids).size !== proof.pgids.length
      || record.children.some(child => !proof.pgids.includes(child.pid))) return '进程组记录不完整或与会话不匹配';
    for (const pgid of proof.pgids) {
      if (exists(pgid) || exists(-pgid)) return `进程组 ${pgid} 仍存在或无法确认退出`;
    }
  } catch { return '进程组记录缺失或无法读取，保留原锁'; }
  return null;
}

export async function sessionEndEvidence(record) {
  if (exists(record.pid)) return `原会话 PID ${record.pid} 仍存在`;
  for (const child of record.children) {
    if (exists(child.pid)) return `子进程 PID ${child.pid} 仍存在`;
  }
  if (process.platform !== 'win32') {
    const reason = await posixGroupEndEvidence(record);
    if (reason) return reason;
    if (exists(record.pid) || record.children.some(child => exists(child.pid))) return '检查期间原会话或子进程 PID 重新出现';
    return null;
  }
  // Legacy normal closes already confirmed cleanup. Tracked sessions always need
  // their receipt if a crash interrupted lease release, even with status stopped.
  if (!record.processTracker && record.status === 'stopped' && Number.isFinite(Date.parse(record.stoppedAt))
    && Date.parse(record.stoppedAt) >= Date.parse(record.startedAt)) return null;
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
