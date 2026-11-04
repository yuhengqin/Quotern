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
export async function connectPage(target, { waitForActionability = false } = {}) {
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
  const ready = async (check, label) => {
    const deadline = Date.now() + 5000;
    do {
      const result = await check();
      if (result) return result;
      await wait(25);
    } while (Date.now() < deadline);
    throw Error(`Timed out waiting for ${label}`);
  };
  const actionablePoint = expression => {
    let previous = null;
    return ready(async () => {
      const current = await evaluate(`(() => {
    const el = (${expression});
    if (!el || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return null;
    el.scrollIntoView({block:'center',inline:'nearest'});
    if (!el.isConnected || document.documentElement.matches(':active-view-transition') || el.closest('[data-entering="true"],[data-exiting="true"]')) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = r.x+r.width/2, y = r.y+r.height/2;
    const hit = document.elementFromPoint(x,y);
    return x >= 0 && y >= 0 && (hit === el || el.contains(hit)) ? {x,y,width:r.width,height:r.height} : null;
  })()`);
      const stable = current && previous && ['x','y','width','height'].every(key => Math.abs(current[key]-previous[key]) <= 0.5);
      previous = current;
      return stable ? {x:current.x,y:current.y} : null;
    }, 'an actionable pointer target');
  };
  const settled = () => {
    let previous = false;
    return ready(async () => {
      const current = await evaluate(`(() => {
    return !document.documentElement.matches(':active-view-transition') && !document.querySelector('[data-entering="true"],[data-exiting="true"]') &&
      !document.getAnimations().some(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime));
  })()`);
      const stable = previous && current;
      previous = current;
      return stable;
    }, 'UI animations before keyboard input');
  };
  await call('Runtime.enable');
  return {
    call, evaluate, errors, target,
    async click(expression, button = 'left', { force = false } = {}) {
      const shouldWait = waitForActionability && !force;
      let point = shouldWait ? await actionablePoint(expression) : await evaluate(`(() => { const el = (${expression}); if (!el) throw Error('Missing target'); el.scrollIntoView({block:'center',inline:'nearest'}); const r=el.getBoundingClientRect(); if(!r.width||!r.height) throw Error('Target is hidden'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      assert.ok(point.x >= 0 && point.y >= 0, 'Target must be in the viewport');
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      // Hover, layout animation and view-transition snapshots can change the hit target.
      if (shouldWait) point = await actionablePoint(expression);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, clickCount: 1 });
    },
    async key(key, code = key === ' ' ? 'Space' : key, modifiers = 0) {
      if (waitForActionability) await settled();
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
