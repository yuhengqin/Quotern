import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import net from 'node:net';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export function jobEvidencePath(record) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(record.sessionId)) throw new Error('Job 会话 ID 无效');
  return join(record.worktree, '.quotern-dev', 'jobs', `${record.sessionId}.json`);
}

export async function startWindowsJob(session) {
  if (process.platform !== 'win32') return null;
  const record = session.record;
  if (record.pid !== process.pid) throw new Error('只能为当前开发主管进程建立 Job 归属');
  const tracker = { kind: 'windows-job-v1', jobName: `Local\\QuoternDev-${record.sessionId}`,
    proofToken: randomUUID(), transport: 'wmi-pipe-v1', setupComplete: false };
  await session.update({ processTracker: tracker });
  const evidencePath = jobEvidencePath(record);
  await mkdir(dirname(evidencePath), { recursive: true });
  const evidence = {
    ...tracker, sessionId: record.sessionId, mode: record.mode, pid: record.pid,
    worktree: record.worktree, startedAt: record.startedAt, status: 'ended',
  };
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'dev-windows-job.ps1');
  const host = join(dirname(fileURLToPath(import.meta.url)), 'dev-windows-job-host.mjs');
  const launcher = join(dirname(fileURLToPath(import.meta.url)), 'dev-windows-job-launch.ps1');
  const pipeName = `\\\\.\\pipe\\QuoternDev-${record.sessionId}-${randomUUID()}`;
  const payload = Buffer.from(JSON.stringify({ pipeName, token: tracker.proofToken, args: [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-SupervisorProcessId', String(record.pid), '-JobName', tracker.jobName,
    '-EvidencePath', evidencePath, '-EvidenceBase64', Buffer.from(JSON.stringify(evidence)).toString('base64'),
  ] })).toString('base64');
  let failure, pending, timer, socket, lines, launchResult, sequence = 0;
  let queue = Promise.resolve();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  function fail(error) {
    failure = error;
    readyReject(error);
    pending?.reject(error);
    pending = null;
  }
  const server = net.createServer((connection) => {
    if (socket) { connection.destroy(); return; }
    socket = connection;
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('Windows Job 监视连接已结束')));
    lines = createInterface({ input: socket });
    let authenticated = false;
    lines.on('line', (line) => {
      queue = queue.then(async () => {
        const message = JSON.parse(line);
        if (!authenticated) {
          const launched = await launchResult;
          if (message.type !== 'host' || message.token !== tracker.proofToken || message.pid !== launched.pid) {
            throw new Error('Windows Job 监视进程身份不匹配');
          }
          authenticated = true;
          tracker.guardianPid = message.pid;
          await session.update({ processTracker: { ...tracker } });
          server.close();
        } else if (message.type === 'prepared') {
          if (!/^\d+$/.test(message.createdAt) || !Number.isSafeInteger(message.windowsSessionId)) {
            throw new Error('Windows Job 主管身份不完整');
          }
          tracker.supervisorCreatedAt = message.createdAt;
          tracker.windowsSessionId = message.windowsSessionId;
          await session.update({ processTracker: { ...tracker } });
          socket.write('attach\n');
        } else if (message.type === 'ready') {
          tracker.setupComplete = true;
          await session.update({ processTracker: { ...tracker } });
          clearTimeout(timer); readyResolve();
        } else if (message.type === 'members' && pending?.id === message.id) {
          if (!Number.isSafeInteger(message.active) || message.active < 1) throw new Error('Job 进程计数无效');
          const request = pending; pending = null; request.resolve(message.active);
        } else if (message.type === 'error') throw new Error(message.message);
      }).catch(fail);
    });
  });
  server.on('error', fail);
  timer = setTimeout(() => fail(new Error('Windows Job 建立超时，未启动开发服务')), 20000);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipeName, resolve); });
    // detached:true only changes the console; taskkill /T and outer Jobs still
    // reach descendants. WMI + BREAKAWAY starts the observer outside that tree.
    launchResult = runFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NodePath', process.execPath,
      '-HostPath', host, '-PayloadBase64', payload], { windowsHide: true, timeout: 15000, encoding: 'utf8' })
      .then(({ stdout }) => {
        const result = JSON.parse(stdout.trim());
        if (!Number.isSafeInteger(result.pid) || result.pid <= 0) throw new Error('Windows Job 监视进程未创建');
        return result;
      });
    launchResult.catch(fail);
    await ready;
  } catch (error) {
    socket?.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
    server.close(); server.unref(); socket?.unref();
  }
  return {
    async childrenEnded(timeout = 2500) {
      socket.ref();
      try {
        const deadline = Date.now() + timeout;
        do {
          if (failure) throw failure;
          const active = await new Promise((resolve, reject) => {
            const expiry = setTimeout(() => reject(new Error('Windows Job 查询超时')), 2000);
            const id = ++sequence;
            pending = { id, resolve: (value) => { clearTimeout(expiry); resolve(value); },
              reject: (error) => { clearTimeout(expiry); reject(error); } };
            socket.write(`check:${id}\n`);
          });
          if (active === 1) return true; // Only the still-live supervisor remains.
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        return false;
      } finally { socket.unref(); }
    },
    detach() {
      socket.end(); lines.close(); socket.destroy(); socket.unref();
    },
  };
}
