import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

export function jobEvidencePath(record) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(record.sessionId)) throw new Error('Job 会话 ID 无效');
  return join(record.worktree, '.quotern-dev', 'jobs', `${record.sessionId}.json`);
}

export async function startWindowsJob(session) {
  if (process.platform !== 'win32') return null;
  const record = session.record;
  if (record.pid !== process.pid) throw new Error('只能为当前开发主管进程建立 Job 归属');
  const tracker = { kind: 'windows-job-v1', jobName: `Local\\QuoternDev-${record.sessionId}`, proofToken: randomUUID() };
  await session.update({ processTracker: tracker });
  const evidencePath = jobEvidencePath(record);
  await mkdir(dirname(evidencePath), { recursive: true });
  const evidence = {
    ...tracker, sessionId: record.sessionId, mode: record.mode, pid: record.pid,
    worktree: record.worktree, startedAt: record.startedAt, status: 'ended',
  };
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'dev-windows-job.ps1');
  const host = join(dirname(fileURLToPath(import.meta.url)), 'dev-windows-job-host.mjs');
  // libuv gives non-detached children a kill-on-close Job. Our observer must
  // survive its parent and be created BEFORE that parent joins our own Job.
  const child = spawn(process.execPath, [host, '-NoLogo', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-File', helper, '-SupervisorProcessId', String(record.pid),
    '-JobName', tracker.jobName, '-EvidencePath', evidencePath,
    '-EvidenceBase64', Buffer.from(JSON.stringify(evidence)).toString('base64')], {
    detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let failure, pending, timer, stderr = '', sequence = 0;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  function fail(error) {
    failure = error;
    readyReject(error);
    pending?.reject(error);
    pending = null;
  }
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === 'prepared') child.stdin.write('attach\n');
      else if (message.type === 'ready') { clearTimeout(timer); readyResolve(); }
      else if (message.type === 'members' && pending?.id === message.id) {
        if (!Number.isSafeInteger(message.active) || message.active < 1) throw new Error('Job 进程计数无效');
        const request = pending; pending = null; request.resolve(message.active);
      }
    } catch (error) { fail(error); }
  });
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
  child.stdin.on('error', fail);
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(`Windows Job 监视进程已退出（${code}）：${stderr.trim()}`)));
  const ref = (enabled) => {
    for (const handle of [child, child.stdin, child.stdout, child.stderr]) handle[enabled ? 'ref' : 'unref']?.();
  };
  timer = setTimeout(() => fail(new Error('Windows Job 建立超时，未启动开发服务')), 15000);
  try {
    await ready;
    await session.update({ processTracker: { ...tracker, guardianPid: child.pid } });
  } catch (error) {
    child.stdin.end();
    throw error;
  } finally {
    clearTimeout(timer);
    ref(false);
  }
  return {
    async childrenEnded(timeout = 2500) {
      ref(true);
      try {
        const deadline = Date.now() + timeout;
        do {
          if (failure) throw failure;
          const active = await new Promise((resolve, reject) => {
            const expiry = setTimeout(() => reject(new Error('Windows Job 查询超时')), 2000);
            const id = ++sequence;
            pending = { id, resolve: (value) => { clearTimeout(expiry); resolve(value); },
              reject: (error) => { clearTimeout(expiry); reject(error); } };
            child.stdin.write(`check:${id}\n`);
          });
          if (active === 1) return true; // Only the still-live supervisor remains.
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        return false;
      } finally { ref(false); }
    },
    detach() {
      child.stdin.end(); lines.close(); child.stdout.destroy(); child.stderr.destroy(); ref(false);
    },
  };
}
