#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createDevSession, readDevStatus } from './dev-instance.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'cli';
if (mode === 'status') {
  console.log(JSON.stringify(await readDevStatus(root), null, 2));
} else {
  await run().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

async function run() {
  const session = await createDevSession(root, mode);
  const log = createWriteStream(session.record.logPath, { flags: 'a' });
  const children = [];
  let closing = false;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let stateQueue = Promise.resolve();
  const update = (patch) => (stateQueue = stateQueue.then(() => session.update(patch)));
  function launch(name, command, args, cwd, ipc = false) {
    const child = spawn(command, args, { cwd, env: session.env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
    children.push({ name, child });
    for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', (data) => { destination.write(data); log.write(data); });
    }
    child.on('error', (error) => { console.error(`${name}: ${error.message}`); void shutdown(1); });
    void update({ children: children.filter(({ child: c }) => c.exitCode == null && c.signalCode == null).map(({ name: n, child: c }) => ({ name: n, pid: c.pid })) });
    return child;
  }
  async function shutdown(code) {
    if (closing) return;
    closing = true;
    try {
      const cleaned = await Promise.all(children.map(async ({ name, child }) => {
        if (!child.pid) return true;
        // Completed build commands are not running services.
        if (name === 'build' && child.exitCode != null) return true;
        if (process.platform === 'win32') {
          if (child.exitCode != null || child.signalCode != null) return false;
          if (child.connected) {
            let acknowledged = false;
            const onStopped = (message) => { if (message?.type === 'quotern-dev-stopped') acknowledged = true; };
            child.on('message', onStopped);
            child.send({ type: 'quotern-dev-stop' });
            await waitUntil(() => acknowledged || child.exitCode != null || child.signalCode != null, 2500);
            child.off('message', onStopped);
          }
          // A dead parent cannot prove its descendants are gone. Keep the lease.
          if (child.exitCode != null || child.signalCode != null) return false;
          return killWindowsTree(child);
        }
        // Detached POSIX children have their own group, which remains addressable
        // after the group leader exits. Wait for the group, not just the parent.
        const groupAlive = () => {
          try { process.kill(-child.pid, 0); return true; }
          catch (error) { if (error.code === 'ESRCH') return false; throw error; }
        };
        if (!groupAlive()) return true;
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        if (await waitUntil(() => !groupAlive(), 2500)) return true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        return waitUntil(() => !groupAlive(), 2500);
      }));
      await stateQueue;
      if (cleaned.every(Boolean)) await session.close(code);
      else {
        console.error('部分服务父进程已退出或进程树清理未确认；保留归属锁，请检查 dev:status 及所属后代进程');
        code = 1;
        await session.update({ status: 'cleanup-required', exitCode: code, stoppedAt: new Date().toISOString() });
      }
    } catch (error) {
      code = 1;
      console.error(`清理未确认，保留归属锁：${error.message}`);
      await session.update({ status: 'cleanup-required', exitCode: code }).catch(() => {});
    } finally {
      for (const { child } of children) {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
      process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
      process.off('message', onMessage);
      if (process.connected) process.disconnect();
      await new Promise((resolve) => log.end(resolve));
      process.exitCode = code;
      finish();
    }
  }
  async function killWindowsTree(child) {
    // Only the live child created by this supervisor; never port/name/global scans.
    if (child.exitCode != null || child.signalCode != null) return false;
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const [code] = await once(killer, 'exit');
    return code === 0 && await waitUntil(() => child.exitCode != null || child.signalCode != null, 2500);
  }
  async function waitUntil(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return check();
  }
  const onSignal = () => { void shutdown(0); };
  const onMessage = (message) => { if (message?.type === 'quotern-dev-stop') void shutdown(0); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  // A test/controller can request cleanup through the supervisor's own IPC channel.
  if (process.send) process.on('message', onMessage);
  function toolBin(packageRoot, tool, relativeBin) {
    const require = createRequire(join(packageRoot, 'package.json'));
    return join(dirname(require.resolve(`${tool}/package.json`)), relativeBin);
  }
  try {
    console.log(`[Quotern dev] ${session.record.branch || '(detached)'} · ${root}`);
    console.log(`会话 ${session.record.sessionId} / PID ${process.pid}`);
    console.log(`API http://127.0.0.1:${session.config.apiPort} · Vite http://127.0.0.1:${mode === 'desktop' ? session.config.desktopPort : session.config.uiPort}`);
    console.log(`数据 ${session.config.dataDir}\n归属 ${session.recordPath}\n日志 ${session.record.logPath}`);
    if (mode !== 'ui') {
      const entry = process.env.npm_execpath;
      if (!entry) throw new Error('请通过 pnpm dev:cli / dev:desktop 启动，以使用仓库指定的包管理器');
      const args = mode === 'desktop' ? ['--filter', 'quotern-desktop^...', 'build'] : ['build:cli'];
      const build = launch('build', process.execPath, [entry, ...args], root);
      await update({ status: 'building' });
      const [code] = await once(build, 'exit');
      if (closing) return await done;
      if (code !== 0) { await shutdown(code ?? 1); return; }
    }
    if (closing) return await done;
    const services = [];
    if (mode === 'cli' || mode === 'api') {
      services.push(launch('cli', process.execPath, [join(root, 'packages/cli/bin/quotern.js'), 'start', '--port', String(session.config.apiPort), '--host', '127.0.0.1', '--quotern-dev-instance', session.record.sessionId], root, true));
    }
    if (mode === 'cli' || mode === 'ui') {
      const cwd = join(root, 'packages/dashboard');
      services.push(launch('vite', process.execPath, [toolBin(cwd, 'vite', 'bin/vite.js'), '--host', '127.0.0.1', '--port', String(session.config.uiPort), '--strictPort'], cwd));
    }
    if (mode === 'desktop') {
      const cwd = join(root, 'apps/desktop');
      // electron-vite 5 reads the renderer host from electron.vite.config.ts;
      // its dev CLI has no --host option (unlike the standalone Vite CLI).
      services.push(launch('electron-vite', process.execPath, [toolBin(cwd, 'electron-vite', 'bin/electron-vite.js'), 'dev'], cwd));
    }
    for (const child of services) child.on('exit', (code) => { if (!closing) void shutdown(code ?? 1); });
    await update({ status: 'running' });
    await done;
  } catch (error) { console.error(error.message); await shutdown(1); }
}
