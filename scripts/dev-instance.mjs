import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, realpath, rm, writeFile, rename, lstat, readdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import { sessionEndEvidence } from './dev-processes.mjs';

const MODES = { cli: ['runtime', 'ui'], api: ['runtime'], ui: ['ui'], desktop: ['runtime', 'desktop-ui'] };
const PORTS = { apiPort: ['QUOTERN_DEV_API_PORT', 8452], uiPort: ['QUOTERN_DEV_UI_PORT', 5194], desktopPort: ['QUOTERN_DEV_DESKTOP_PORT', 5195] };

function portValue(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`开发端口必须为 1024–65535 的整数：${value}`);
  return port;
}
function proxyOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error('开发代理目标必须是无凭据、无路径的本地 HTTP(S) origin'); }
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveJson(path, record) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(tmp, path);
}
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
export async function readDevStatus(root) {
  const dir = join(root, '.quotern-dev');
  const sessions = [];
  for (const mode of Object.keys(MODES)) {
    const record = await readJson(join(dir, `${mode}.json`));
    if (record) sessions.push({ ...record, supervisorAlive: pidAlive(record.pid) });
  }
  return { config: await readJson(join(dir, 'instance.json')), sessions };
}
async function portAvailableOnHost(port, host) {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
async function portAvailable(port, host) {
  const hosts = new Set();
  // Windows may allow a wildcard bind beside an existing specific-address
  // listener. Probe local IPv4 addresses first so those listeners stay protected.
  if (process.platform === 'win32' && host === '0.0.0.0') {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses) {
        if (address.family === 'IPv4') hosts.add(address.address);
      }
    }
  }
  hosts.add(host);
  for (const listenHost of hosts) {
    if (!await portAvailableOnHost(port, listenHost)) return false;
  }
  return true;
}
async function choosePort(first, explicit, excluded, host) {
  for (let port = first; port <= 65535; port++) {
    if (!excluded.has(port) && await portAvailable(port, host)) return port;
    if (explicit) throw new Error(`开发端口 ${port} 已被占用；请选择其他端口，不要停止其他会话的服务`);
  }
  throw new Error('没有可用的开发端口');
}

// Every acquisition, recovery and release uses the same gate. A gate left by a
// crashed inspector is deliberately not auto-reclaimed (its operation is unknown).
async function withResourceGate(dir, resource, action) {
  const gate = join(dir, `${resource}.guard`);
  let acquired = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    try { await mkdir(gate); acquired = true; break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!acquired) throw new Error(`开发资源 ${resource} 的锁检查尚未完成；请核对 ${gate}，禁止自动接管`);
  try {
    await saveJson(join(gate, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString(), resource });
    return await action();
  } finally {
    await rm(join(gate, 'owner.json'), { force: true });
    await rmdir(gate);
  }
}

async function removeLease(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('归属锁不是普通目录');
  const entries = await readdir(path);
  if (entries.length !== 1 || entries[0] !== 'owner.json') throw new Error('归属锁包含未知内容，保留原锁');
  await unlink(join(path, 'owner.json'));
  await rmdir(path);
}

async function recoverLease(root, dir, resource, path) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return '归属锁不是普通目录';
    const owner = await readJson(join(path, 'owner.json'));
    if (!owner || !MODES[owner.mode]?.includes(resource) || typeof owner.sessionId !== 'string'
      || !owner.sessionId || owner.worktree !== root || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || !Number.isFinite(Date.parse(owner.startedAt)) || Date.parse(owner.startedAt) > Date.now()) return '归属记录不完整';
    if (pidAlive(owner.pid)) return `原会话 PID ${owner.pid} 仍存在`;
    const record = await readJson(join(dir, `${owner.mode}.json`));
    if (!record || ['sessionId', 'mode', 'pid', 'worktree', 'startedAt'].some((key) => record[key] !== owner[key])
      || !['starting', 'building', 'running', 'cleanup-required', 'stopped'].includes(record.status)
      || !Array.isArray(record.children) || record.children.some((child) => !child
        || !Number.isSafeInteger(child.pid) || child.pid <= 0)) return '会话记录缺失、不完整或与锁归属不匹配';
    if (record.status === 'stopped' && (!Number.isFinite(Date.parse(record.stoppedAt))
      || Date.parse(record.stoppedAt) < Date.parse(record.startedAt) || Date.parse(record.stoppedAt) > Date.now())) {
      return '会话结束记录不完整';
    }
    const reason = await sessionEndEvidence(record);
    if (reason) return reason;
    // The gate serializes all cooperating writers. Re-read before deletion too.
    const latestOwner = await readJson(join(path, 'owner.json'));
    const latestRecord = await readJson(join(dir, `${owner.mode}.json`));
    if (JSON.stringify(latestOwner) !== JSON.stringify(owner) || JSON.stringify(latestRecord) !== JSON.stringify(record)) {
      return '检查期间会话记录发生变化';
    }
    await removeLease(path);
    console.log(`[Quotern dev] 已确认旧会话 ${owner.sessionId} 结束，自动清理 ${resource}.lock`);
    return null;
  } catch (error) { return `无法确认残留锁可恢复：${error.message}`; }
}

/** Leases never signal a PID. Only positively checked, matching stale leases recover. */
export async function createDevSession(root, mode, inputEnv = process.env) {
  if (!MODES[mode]) throw new Error(`未知开发模式：${mode}`);
  const host = inputEnv.QUOTERN_DEV_HOST?.trim() || '127.0.0.1';
  root = await realpath(root);
  const explicit = {};
  for (const [key, [variable]] of Object.entries(PORTS)) {
    if (inputEnv[variable] != null) explicit[key] = portValue(inputEnv[variable]);
  }
  if (new Set(Object.values(explicit)).size !== Object.keys(explicit).length) throw new Error('开发端口不能重复');
  const externalOrigin = inputEnv.VITE_CLI_API_ORIGIN ? proxyOrigin(inputEnv.VITE_CLI_API_ORIGIN) : null;
  if (externalOrigin && mode !== 'ui') throw new Error('指定代理目标时请使用 dev:cli:ui；完整 CLI 实例必须代理自己的 API');
  const dir = join(root, '.quotern-dev');
  await mkdir(dir, { recursive: true });
  const record = {
    sessionId: randomUUID(), mode, pid: process.pid, worktree: root, host,
    branch: '', command: process.argv, startedAt: new Date().toISOString(),
    status: 'starting', children: [],
  };
  try { record.branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { /* Non-Git fixtures also use the launcher. */ }
  const leases = [];
  const release = async () => {
    for (const resource of leases) {
      await withResourceGate(dir, resource, async () => {
        const path = join(dir, `${resource}.lock`);
        const owner = await readJson(join(path, 'owner.json'));
        if (owner?.sessionId === record.sessionId) await removeLease(path);
      });
    }
  };
  try {
    for (const resource of MODES[mode]) {
      const path = join(dir, `${resource}.lock`);
      await withResourceGate(dir, resource, async () => {
        try { await mkdir(path); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const reason = await recoverLease(root, dir, resource, path);
          if (reason) throw new Error(`开发资源 ${resource} 已有会话归属；${reason}；运行 pnpm dev:status 核对，禁止自动停止或接管`);
          await mkdir(path);
        }
        await saveJson(join(path, 'owner.json'), record);
        leases.push(resource);
      });
    }
    // Serialize config selection across separate API/UI launchers in one worktree.
    const configLock = join(dir, 'config.lock');
    let handle;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { handle = await open(configLock, 'wx'); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!handle) throw new Error('开发配置正被其他会话更新；请检查 .quotern-dev/config.lock 后重试');
    let config;
    try {
      config = await readJson(join(dir, 'instance.json')) ?? {};
      if (mode === 'ui' && !externalOrigin) {
        const owner = await readJson(join(dir, 'runtime.lock', 'owner.json'));
        if (!owner || !['cli', 'api'].includes(owner.mode) || !pidAlive(owner.pid)) {
          throw new Error('本 worktree 尚无所属 CLI API；请先启动 pnpm dev:cli:api，或用 VITE_CLI_API_ORIGIN 显式复用其他 API');
        }
        if (config.apiSessionId !== owner.sessionId || config.apiOwnerPid !== owner.pid) {
          throw new Error('本 worktree API 端口配置尚未发布，或 API 配置归属不匹配；待所属 API 就绪后重试');
        }
        let ready = false;
        try {
          const response = await fetch(`http://127.0.0.1:${portValue(config.apiPort)}/health`, { signal: AbortSignal.timeout(1000) });
          ready = response.ok && response.headers.get('X-Quotern-Dev-Instance') === owner.sessionId;
          await response.body?.cancel();
        } catch { /* Starting or unrelated API is not authorized by a lease alone. */ }
        if (!ready) throw new Error('本 worktree API 尚未就绪，或 API 响应标识与会话归属不匹配；待所属 API 就绪后重试');
      }
      const active = mode === 'cli' ? ['apiPort', 'uiPort'] : mode === 'api' ? ['apiPort'] : mode === 'desktop' ? ['desktopPort'] : ['uiPort'];
      for (const [key, [, fallback]] of Object.entries(PORTS)) config[key] = portValue(config[key] ?? fallback);
      let pinnedApi = false;
      if (mode === 'api') {
        const uiOwner = await readJson(join(dir, 'ui.lock', 'owner.json'));
        if (uiOwner) {
          const ui = await readJson(join(dir, 'ui.json'));
          if (!ui || ui.sessionId !== uiOwner.sessionId || !pidAlive(uiOwner.pid)) {
            throw new Error('UI 代理归属尚未确认；请核对 dev:status 后再启动 API');
          }
          pinnedApi = ui.proxyTarget === `http://127.0.0.1:${config.apiPort}`;
          if (pinnedApi && explicit.apiPort != null && explicit.apiPort !== config.apiPort) {
            throw new Error('已有 UI 代理当前 API 端口；请先退出所属 UI，再调整 API 端口');
          }
        }
      }
      for (const key of active) {
        const excluded = new Set(Object.keys(PORTS).filter((other) => other !== key).map((other) => config[other]));
        config[key] = await choosePort(explicit[key] ?? config[key], explicit[key] != null || (key === 'apiPort' && pinnedApi), excluded, host);
      }
      config.worktree = root;
      config.dataDir = join(dir, 'data');
      config.configHome = join(dir, 'config-home');
      config.desktopUserData = join(dir, 'electron');
      if (mode === 'cli' || mode === 'api') {
        config.apiSessionId = record.sessionId;
        config.apiOwnerPid = record.pid;
      }
      await saveJson(join(dir, 'instance.json'), config);
    } finally {
      await handle.close();
      await rm(configLock);
    }
    const origin = externalOrigin ?? `http://127.0.0.1:${config.apiPort}`;
    const env = {
      ...inputEnv, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DATA_DIR: config.dataDir,
      QUOTERN_DEV_INSTANCE_ID: record.sessionId,
      QUOTERN_DEV_HOST: host,
      QUOTERN_CONFIG_HOME: config.configHome, QUOTERN_DESKTOP_USER_DATA: config.desktopUserData,
      QUOTERN_DEV_API_PORT: String(config.apiPort), QUOTERN_DEV_UI_PORT: String(config.uiPort),
      QUOTERN_DEV_DESKTOP_PORT: String(config.desktopPort), VITE_CLI_API_ORIGIN: origin,
      VITE_API_TARGET: 'cli',
    };
    const recordPath = join(dir, `${mode}.json`);
    record.ports = { api: config.apiPort, ui: config.uiPort, desktop: config.desktopPort };
    record.dataDir = config.dataDir;
    record.proxyTarget = origin;
    record.logPath = join(dir, `${mode}.log`);
    await saveJson(recordPath, record);
    let closed = false;
    return {
      config, env, record, recordPath,
      async update(patch) { Object.assign(record, patch); await saveJson(recordPath, record); },
      async close(exitCode = 0) {
        if (closed) return;
        closed = true;
        Object.assign(record, { status: 'stopped', stoppedAt: new Date().toISOString(), exitCode });
        try { await saveJson(recordPath, record); } finally { await release(); }
      },
    };
  } catch (error) { await release(); throw error; }
}
