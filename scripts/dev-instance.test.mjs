import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createDevSession as createSession, readDevStatus } from './dev-instance.mjs';

const ownedSessions = new Map();
async function createDevSession(...args) {
  const session = await createSession(...args);
  const list = ownedSessions.get(args[0]) ?? [];
  list.push(session);
  ownedSessions.set(args[0], list);
  return session;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-dev-'));
  t.after(async () => {
    for (const session of ownedSessions.get(root) ?? []) await session.close();
    ownedSessions.delete(root);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function listener(t, port = 0, host = '127.0.0.1') {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.end('other-session');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}
async function ownApi(t, session) {
  const server = http.createServer((_request, response) => {
    response.setHeader('X-Quotern-Dev-Instance', session.record.sessionId);
    response.end('{"ok":true}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(session.config.apiPort, '127.0.0.1', resolve); });
  const close = () => new Promise((resolve) => server.close(resolve));
  t.after(close);
  return close;
}

test('occupied explicit port fails without stopping its listener', async (t) => {
  const root = await fixture(t);
  const port = await listener(t);
  await assert.rejects(createDevSession(root, 'api', { QUOTERN_DEV_API_PORT: String(port) }), /占用/);
  const socket = net.connect(port, '127.0.0.1');
  assert.equal(await new Promise((resolve) => socket.once('data', (data) => resolve(data.toString()))), 'other-session');
});

test('host defaults to loopback and is normalized for all child services', async (t) => {
  for (const [input, expected] of [[undefined, '127.0.0.1'], ['', '127.0.0.1'], ['  ', '127.0.0.1'], [' 0.0.0.0 ', '0.0.0.0']]) {
    const session = await createDevSession(await fixture(t), 'cli', { QUOTERN_DEV_HOST: input });
    assert.equal(session.env.QUOTERN_DEV_HOST, expected);
    assert.equal(session.record.host, expected);
    assert.equal(session.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${session.config.apiPort}`);
  }
});

test('wildcard port selection detects listeners on another interface without stopping them', async (t) => {
  const host = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address;
  if (!host) return t.skip('no non-loopback IPv4 interface');
  const port = await listener(t, 0, host);
  const root = await fixture(t);
  await mkdir(join(root, '.quotern-dev'));
  await writeFile(join(root, '.quotern-dev/instance.json'), JSON.stringify({ apiPort: port }));
  await assert.rejects(createDevSession(root, 'api', { QUOTERN_DEV_HOST: '0.0.0.0', QUOTERN_DEV_API_PORT: String(port) }), /占用/);
  const session = await createDevSession(root, 'api', { QUOTERN_DEV_HOST: '0.0.0.0' });
  assert.notEqual(session.config.apiPort, port);
  const socket = net.connect(port, host);
  assert.equal(await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('data', data => resolve(data.toString()));
  }), 'other-session');
});

test('two worktrees get private state and a free port when the saved port is busy', async (t) => {
  const a = await createDevSession(await fixture(t), 'cli', {});
  t.after(() => a.close());
  await listener(t, a.config.apiPort);
  await listener(t, a.config.uiPort);
  const b = await createDevSession(await fixture(t), 'cli', {});
  t.after(() => b.close());
  assert.notEqual(a.env.QUOTERN_DATA_DIR, b.env.QUOTERN_DATA_DIR);
  assert.notEqual(a.env.QUOTERN_CONFIG_HOME, b.env.QUOTERN_CONFIG_HOME);
  assert.notEqual(a.config.apiPort, b.config.apiPort);
  assert.notEqual(a.config.uiPort, b.config.uiPort);
  assert.equal(b.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${b.config.apiPort}`);
  assert.equal(b.env.QUOTERN_DEV_ISOLATED, '1');
});

test('a second runtime in the same worktree is refused and cannot remove the first lease', async (t) => {
  const root = await fixture(t);
  const first = await createDevSession(root, 'api', {});
  t.after(() => first.close());
  await assert.rejects(createDevSession(root, 'desktop', {}), /会话|归属/);
  const status = await readDevStatus(root);
  assert.equal(status.sessions[0].sessionId, first.record.sessionId);
  assert.equal(status.sessions[0].status, 'starting');
});

test('API and UI may run separately, UI uses this worktree API and retains ports', async (t) => {
  const root = await fixture(t);
  const api = await createDevSession(root, 'api', {});
  t.after(() => api.close());
  await ownApi(t, api);
  const ui = await createDevSession(root, 'ui', {});
  t.after(() => ui.close());
  assert.equal(ui.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${api.config.apiPort}`);
  await ui.update({ status: 'running', children: [{ name: 'vite', pid: 42 }] });
  await ui.close(0);
  const record = JSON.parse(await readFile(ui.recordPath, 'utf8'));
  assert.equal(record.status, 'stopped');
  assert.equal(record.exitCode, 0);
  assert.ok(record.stoppedAt);
  assert.equal((await readDevStatus(root)).sessions.find((s) => s.mode === 'api').sessionId, api.record.sessionId);
});

test('invalid configuration fails before creating a runtime lease', async (t) => {
  const root = await fixture(t);
  await assert.rejects(createDevSession(root, 'cli', { QUOTERN_DEV_API_PORT: 'NaN' }), /端口/);
  await assert.rejects(createDevSession(root, 'cli', { QUOTERN_DEV_API_PORT: '42001', QUOTERN_DEV_UI_PORT: '42001' }), /端口/);
  await assert.rejects(createDevSession(root, 'ui', { VITE_CLI_API_ORIGIN: 'http://user:pass@localhost:1/path' }), /代理/);
  assert.deepEqual((await readDevStatus(root)).sessions, []);
});

test('UI cannot silently proxy an unrelated API without explicit reuse', async (t) => {
  const root = await fixture(t);
  await assert.rejects(createDevSession(root, 'ui', {}), /本 worktree.*API/);
  const ui = await createDevSession(root, 'ui', { VITE_CLI_API_ORIGIN: 'http://127.0.0.1:42099' });
  assert.equal(ui.env.VITE_CLI_API_ORIGIN, 'http://127.0.0.1:42099');
});

test('API restart refuses port drift while its existing UI is still serving', async (t) => {
  const root = await fixture(t);
  const api = await createDevSession(root, 'api', {});
  const closeApi = await ownApi(t, api);
  const ui = await createDevSession(root, 'ui', {});
  const originalPort = api.config.apiPort;
  await api.close();
  await closeApi();
  await listener(t, originalPort);
  await assert.rejects(createDevSession(root, 'api', {}), /占用/);
  await assert.rejects(createDevSession(root, 'api', { QUOTERN_DEV_API_PORT: String(originalPort + 20) }), /代理|UI/);
  assert.equal(ui.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${originalPort}`);
  assert.equal((await readDevStatus(root)).config.apiPort, originalPort);
});

test('an API lease published before its port configuration cannot authorize a UI proxy', async (t) => {
  const root = await fixture(t);
  const port = await listener(t);
  const dir = join(root, '.quotern-dev');
  await mkdir(join(dir, 'runtime.lock'), { recursive: true });
  await writeFile(join(dir, 'runtime.lock/owner.json'), JSON.stringify({ pid: process.pid, mode: 'api', sessionId: 'new-api-starting' }));
  await writeFile(join(dir, 'instance.json'), JSON.stringify({ apiPort: port, apiSessionId: 'old-api', apiOwnerPid: process.pid }));
  await assert.rejects(createDevSession(root, 'ui', {}), /API.*发布|API.*归属/);
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'new-api-starting');
});

test('a published API lease cannot authorize an unrelated server on its port', async (t) => {
  const root = await fixture(t);
  const api = await createDevSession(root, 'api', {});
  await listener(t, api.config.apiPort);
  await assert.rejects(createDevSession(root, 'ui', {}), /API.*标识|API.*就绪/);
});

async function staleDesktop(t, patch = {}, tracked = true) {
  const root = await fixture(t);
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
  await once(child, 'exit');
  const record = {
    sessionId: 'old-desktop', mode: 'desktop', pid: child.pid, worktree: root,
    startedAt, status: 'stopped', children: [], stoppedAt: new Date().toISOString(), exitCode: 0,
    ...patch,
  };
  const dir = join(root, '.quotern-dev');
  if (process.platform !== 'win32' && tracked && !record.processTracker) {
    record.processTracker = { kind: 'posix-pgroups-v1', proofToken: randomUUID() };
    await mkdir(join(dir, 'process-groups'), { recursive: true });
    await writeFile(join(dir, 'process-groups/old-desktop.json'), JSON.stringify({
      ...record.processTracker, sessionId: record.sessionId, mode: record.mode, pid: record.pid,
      worktree: record.worktree, startedAt: record.startedAt, pendingSpawn: false, pgids: [],
    }));
  }
  for (const name of ['runtime', 'desktop-ui']) {
    await mkdir(join(dir, `${name}.lock`), { recursive: true });
    await writeFile(join(dir, `${name}.lock/owner.json`), JSON.stringify(record));
  }
  await writeFile(join(dir, 'desktop.json'), JSON.stringify(record));
  return { root, dir, record };
}

test('confirmed stopped session locks are recovered on the next desktop launch', async (t) => {
  const { root, dir } = await staleDesktop(t);
  const session = await createDevSession(root, 'desktop', {});
  assert.notEqual(session.record.sessionId, 'old-desktop');
  for (const name of ['runtime', 'desktop-ui']) {
    const owner = JSON.parse(await readFile(join(dir, `${name}.lock/owner.json`), 'utf8'));
    assert.equal(owner.sessionId, session.record.sessionId);
  }
});

test('POSIX crashed sessions recover only with complete matching process-group evidence', { skip: process.platform === 'win32' }, async (t) => {
  const { root, dir } = await staleDesktop(t, { status: 'running' });
  const session = await createDevSession(root, 'desktop', {});
  assert.notEqual(session.record.sessionId, 'old-desktop');
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, session.record.sessionId);
});

test('POSIX legacy sessions without complete group history remain blocked', { skip: process.platform === 'win32' }, async (t) => {
  for (const status of ['running', 'stopped']) {
    const { root, dir } = await staleDesktop(t, { status }, false);
    await assert.rejects(createDevSession(root, 'desktop', {}), /进程组/);
    assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'old-desktop');
  }
});

test('POSIX recovery preserves locks for missing, corrupt, incomplete or mismatched group records', { skip: process.platform === 'win32' }, async (t) => {
  const { root, dir } = await staleDesktop(t, { status: 'running' });
  const path = join(dir, 'process-groups/old-desktop.json');
  const proof = JSON.parse(await readFile(path, 'utf8'));
  await rm(path);
  await assert.rejects(createDevSession(root, 'desktop', {}), /进程组/);
  await writeFile(path, '{broken');
  await assert.rejects(createDevSession(root, 'desktop', {}), /进程组/);
  for (const patch of [{ pendingSpawn: true }, { proofToken: randomUUID() }, { sessionId: 'other' }, { mode: 'api' }, { kind: 'other' }, { pgids: [0] }, { pgids: [] , pendingSpawn: null }]) {
    await writeFile(path, JSON.stringify({ ...proof, ...patch }));
    await assert.rejects(createDevSession(root, 'desktop', {}), /进程组/);
  }
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'old-desktop');
});

test('POSIX recovery checks journal groups omitted from the current child list and never stops them', { skip: process.platform === 'win32' }, async (t) => {
  const group = spawn(process.execPath, ['-e', 'setInterval(() => {},1000)'], { detached: true, stdio: 'ignore' });
  const exited = once(group, 'exit');
  t.after(async () => { if (group.exitCode == null && group.signalCode == null) group.kill(); await exited; });
  const { root, dir } = await staleDesktop(t, { status: 'running', children: [] });
  const path = join(dir, 'process-groups/old-desktop.json');
  const proof = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...proof, pgids: [group.pid] }));
  await assert.rejects(createDevSession(root, 'desktop', {}), /进程组/);
  assert.doesNotThrow(() => process.kill(group.pid, 0));
  group.kill();
  await exited;
  const session = await createDevSession(root, 'desktop', {});
  assert.notEqual(session.record.sessionId, 'old-desktop');
});

test('recovery refuses a live recorded child and preserves the old locks', async (t) => {
  const { root, dir } = await staleDesktop(t, { children: [{ name: 'electron-vite', pid: process.pid }] });
  await assert.rejects(createDevSession(root, 'desktop', {}), /子进程|归属/);
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'old-desktop');
});

test('recovery refuses mismatched or incomplete session evidence', async (t) => {
  const { root, dir, record } = await staleDesktop(t);
  await writeFile(join(dir, 'desktop.json'), JSON.stringify({ ...record, sessionId: 'different' }));
  await assert.rejects(createDevSession(root, 'desktop', {}), /归属|记录/);
  await rm(join(dir, 'desktop.json'));
  await assert.rejects(createDevSession(root, 'desktop', {}), /归属|记录/);
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'old-desktop');
});

test('concurrent recovery has one winner and cannot remove its new locks', async (t) => {
  const { root, dir } = await staleDesktop(t);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => createDevSession(root, 'desktop', {})));
  const winners = results.filter((result) => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  for (const name of ['runtime', 'desktop-ui']) {
    assert.equal(JSON.parse(await readFile(join(dir, `${name}.lock/owner.json`), 'utf8')).sessionId,
      winners[0].value.record.sessionId);
  }
});

test('Windows legacy abnormal sessions require explicit recovery evidence', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async (t) => {
  const { root } = await staleDesktop(t, { status: 'running' });
  await assert.rejects(createDevSession(root, 'desktop', {}), /Job|进程归属/);
});

test('completed Windows Job evidence recovers its session without inspecting unrelated orphans', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const tracker = { kind: 'windows-job-v1', jobName: 'Local\\QuoternDev-old-desktop', proofToken: randomUUID() };
  const { root, dir, record } = await staleDesktop(t, { status: 'cleanup-required', processTracker: tracker });
  await mkdir(join(dir, 'jobs'));
  await writeFile(join(dir, 'jobs/old-desktop.json'), JSON.stringify({
    kind: tracker.kind, jobName: tracker.jobName, proofToken: tracker.proofToken,
    sessionId: record.sessionId, mode: record.mode, pid: record.pid, worktree: record.worktree, startedAt: record.startedAt, status: 'ended',
  }));
  const session = await createDevSession(root, 'desktop', {});
  assert.notEqual(session.record.sessionId, 'old-desktop');
});

test('tracked locks reject missing, corrupt and mismatched receipts even when marked stopped', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const tracker = { kind: 'windows-job-v1', jobName: 'Local\\QuoternDev-old-desktop', proofToken: randomUUID() };
  const { root, dir, record } = await staleDesktop(t, { processTracker: tracker });
  await assert.rejects(createDevSession(root, 'desktop', {}), /Job.*凭据/);
  await mkdir(join(dir, 'jobs'));
  const path = join(dir, 'jobs/old-desktop.json');
  await writeFile(path, '{"status":');
  await assert.rejects(createDevSession(root, 'desktop', {}), /凭据无法读取/);
  const proof = { ...tracker, sessionId: record.sessionId, mode: record.mode, pid: record.pid,
    worktree: record.worktree, startedAt: record.startedAt, status: 'ended' };
  for (const patch of [{ proofToken: randomUUID() }, { sessionId: 'other' }, { mode: 'api' }, { status: 'ready' }]) {
    await writeFile(path, JSON.stringify({ ...proof, ...patch }));
    await assert.rejects(createDevSession(root, 'desktop', {}), /凭据.*不匹配/);
  }
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'old-desktop');
});

test('matching Windows Job receipts allow recovery when historical PIDs have been reused', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const tracker = { kind: 'windows-job-v1', jobName: 'Local\\QuoternDev-old-desktop', proofToken: randomUUID() };
  const { root, dir, record } = await staleDesktop(t, {
    status: 'running', processTracker: tracker,
    pid: process.pid, children: [{ name: 'old-service', pid: process.pid }],
  });
  await mkdir(join(dir, 'jobs'));
  await writeFile(join(dir, 'jobs/old-desktop.json'), JSON.stringify({
    ...tracker, sessionId: record.sessionId, mode: record.mode, pid: record.pid,
    worktree: record.worktree, startedAt: record.startedAt, status: 'ended',
  }));
  const recovered = await createDevSession(root, 'desktop', {});
  assert.notEqual(recovered.record.sessionId, record.sessionId);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('unknown lock contents are preserved instead of recursively removed', async (t) => {
  const { root, dir } = await staleDesktop(t);
  await writeFile(join(dir, 'runtime.lock/unexpected'), 'keep');
  await assert.rejects(createDevSession(root, 'desktop', {}), /未知内容/);
  assert.equal(await readFile(join(dir, 'runtime.lock/unexpected'), 'utf8'), 'keep');
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'old-desktop');
});

function sessionProcess(t, root) {
  const source = `
    import { createDevSession } from ${JSON.stringify(new URL('./dev-instance.mjs', import.meta.url).href)};
    try {
      const session = await createDevSession(process.argv[1], 'desktop', {});
      process.on('message', async () => { await session.close(); process.disconnect(); });
      process.send({ state: 'acquired', sessionId: session.record.sessionId });
    } catch (error) {
      process.send({ state: 'refused', message: error.message }, () => process.disconnect());
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, root], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const exited = once(child, 'exit');
  const ready = once(child, 'message', { signal: AbortSignal.timeout(15000) }).then(([message]) => message);
  t.after(async () => {
    if (child.connected) child.send('close');
    if (child.exitCode == null && child.signalCode == null) {
      try { await once(child, 'exit', { signal: AbortSignal.timeout(5000) }); }
      catch { child.kill(); await exited; assert.fail(`session fixture did not close: ${stderr}`); }
    }
  });
  return { child, ready, exited };
}

test('independent launchers racing to recover stale locks leave exactly one live owner', async (t) => {
  const { root, dir } = await staleDesktop(t);
  const launchers = Array.from({ length: 4 }, () => sessionProcess(t, root));
  const results = await Promise.all(launchers.map((launcher) => launcher.ready));
  const winnerIndexes = results.flatMap((result, index) => result.state === 'acquired' ? [index] : []);
  assert.equal(winnerIndexes.length, 1, JSON.stringify(results));
  const winner = winnerIndexes[0];
  await Promise.all(launchers.filter((_, index) => index !== winner).map((launcher) => launcher.exited));
  for (const name of ['runtime', 'desktop-ui']) {
    const owner = JSON.parse(await readFile(join(dir, `${name}.lock/owner.json`), 'utf8'));
    assert.equal(owner.sessionId, results[winner].sessionId);
    assert.equal(owner.pid, launchers[winner].child.pid);
  }
});

test('a closing launcher cannot remove the next independent launcher ownership', async (t) => {
  const root = await fixture(t);
  const first = sessionProcess(t, root);
  assert.equal((await first.ready).state, 'acquired');
  let next = sessionProcess(t, root);
  first.child.send('close');
  const competing = await next.ready;
  await first.exited;
  if (competing.state === 'refused') {
    await next.exited;
    next = sessionProcess(t, root);
  }
  const acquired = await next.ready;
  assert.equal(acquired.state, 'acquired');
  for (const name of ['runtime', 'desktop-ui']) {
    const owner = JSON.parse(await readFile(join(root, `.quotern-dev/${name}.lock/owner.json`), 'utf8'));
    assert.equal(owner.sessionId, acquired.sessionId);
    assert.equal(owner.pid, next.child.pid);
  }
});
