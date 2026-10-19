// Shared, opt-in Electron acceptance driver. Never attaches to an existing app.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export async function launchProbe(executable, output, { args = [], env: extraEnv = {} } = {}) {
  const directory = path.resolve(output);
  await mkdir(directory, { recursive: true });
  assert.ok(!existsSync(path.join(directory, 'electron')) && !existsSync(path.join(directory, 'data')), 'Use a new, dedicated acceptance output directory');
  const port = await unusedPort();
  const env = { ...process.env, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DESKTOP_USER_DATA: path.join(directory, 'electron'), QUOTERN_DATA_DIR: path.join(directory, 'data'), QUOTERN_CONFIG_HOME: path.join(directory, 'config-home'), PORTABLE_EXECUTABLE_FILE: path.resolve(executable), ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.resolve(executable), [...args, `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const clients = [];
  const deadline = setTimeout(() => child.kill(), 600_000);
  const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(page => page.type === 'page');
  return {
    child, directory, pages,
    async connect(predicate = () => true) {
      let target;
      for (let i = 0; i < 120; i++) { try { target = (await pages()).find(predicate); } catch {} if (target) break; await wait(100); }
      assert.ok(target, `No renderer: ${stderr}`);
      const client = await connectPage(target);
      clients.push(client);
      return client;
    },
    async close() {
      clearTimeout(deadline);
      if (child.exitCode === null) {
        for (const client of clients) {
          try { await client.evaluate('window.tud?.quit(); true'); } catch {}
        }
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2500)]);
      }
      for (const client of clients) client.close();
      if (child.exitCode === null) child.kill();
      await writeFile(path.join(directory, 'stdout.log'), stdout);
      await writeFile(path.join(directory, 'stderr.log'), stderr);
    },
  };
}
export async function connectPage(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    pending.get(message.id)?.(message);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(Error(message.error.message)) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Runtime.enable');
  return {
    call, evaluate, errors, target,
    async click(expression, button = 'left') {
      const point = await evaluate(`(() => { const el = (${expression}); if (!el) throw Error('Missing target'); el.scrollIntoView({block:'center',inline:'nearest'}); const r=el.getBoundingClientRect(); if(!r.width||!r.height) throw Error('Target is hidden'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      assert.ok(point.x >= 0 && point.y >= 0, 'Target must be in the viewport');
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, clickCount: 1 });
    },
    async key(key, code = key === ' ' ? 'Space' : key, modifiers = 0) {
      const windowsVirtualKeyCode = { ' ': 32, Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, a: 65 }[key];
      const text = !modifiers && (key === 'Enter' || key === ' ') ? { text: key === 'Enter' ? '\r' : ' ', unmodifiedText: key === 'Enter' ? '\r' : ' ' } : {};
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...text, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) });
    },
    async fill(expression, text) {
      await this.click(expression);
      await this.key('a', 'KeyA', 2);
      if (text) await call('Input.insertText', { text: String(text) });
      else await this.key('Backspace');
    },
    async screenshot(file) { const result = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(file, Buffer.from(result.data, 'base64')); },
    close() { socket.close(); },
  };
}
