import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, realpath, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';

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
async function portAvailable(port, host) {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
async function choosePort(first, explicit, excluded, host) {
  for (let port = first; port <= 65535; port++) {
    if (!excluded.has(port) && await portAvailable(port, host)) return port;
    if (explicit) throw new Error(`开发端口 ${port} 已被占用；请选择其他端口，不要停止其他会话的服务`);
  }
  throw new Error('没有可用的开发端口');
}

/** Leases never signal a PID. A stale/unknown lease requires inspection, not takeover. */
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
    for (const path of leases) {
      const owner = await readJson(join(path, 'owner.json'));
      if (owner?.sessionId === record.sessionId) await rm(path, { recursive: true });
    }
  };
  try {
    for (const resource of MODES[mode]) {
      const path = join(dir, `${resource}.lock`);
      try { await mkdir(path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = await readJson(join(path, 'owner.json'));
        throw new Error(`开发资源 ${resource} 已有会话归属${owner ? `（PID ${owner.pid}，${owner.mode}）` : '（归属尚未写完或未知）'}；运行 pnpm dev:status 核对，禁止自动停止或接管`);
      }
      leases.push(path);
      await saveJson(join(path, 'owner.json'), record);
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
