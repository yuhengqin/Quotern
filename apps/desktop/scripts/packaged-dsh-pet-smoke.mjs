// Test a local unpacked Windows build through its actual preload IPC. All data is isolated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [exe, output] = process.argv.slice(2);
assert.ok(exe && output, 'exe output');
const directory = path.resolve(output); await mkdir(directory, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const api = createServer(async (req, res) => { for await (const _chunk of req) {} res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Packaged local mock reply' }, finish_reason: 'stop' }] })); });
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const env = { ...process.env, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DESKTOP_USER_DATA: path.join(directory, 'electron'), QUOTERN_DATA_DIR: path.join(directory, 'data'), QUOTERN_CONFIG_HOME: path.join(directory, 'config-home'), PORTABLE_EXECUTABLE_FILE: path.resolve(exe) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.resolve(exe), [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', client, evaluate, sequence = 0; const pending = new Map();
child.stdout.on('data', value => { stdout += String(value); }); child.stderr.on('data', value => { stderr += String(value); });
const deadline = setTimeout(() => child.kill(), 90_000);
try {
  let target;
  for (let attempt = 0; attempt < 120; attempt++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(value => value.type === 'page' && /index\.html/.test(value.url)); } catch {} if (target) break; await wait(250); }
  assert.ok(target, `No main renderer: ${stderr}`);
  client = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { client.addEventListener('open', resolve, { once: true }); client.addEventListener('error', reject, { once: true }); });
  client.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id && pending.has(value.id)) { pending.get(value.id)(value); pending.delete(value.id); } });
  const call = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 60_000); pending.set(id, value => { clearTimeout(timer); value.error ? reject(Error(value.error.message)) : resolve(value.result); }); client.send(JSON.stringify({ id, method, params })); });
  evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const dispatch = action => evaluate(`window.tud.dshPet.dispatch(${JSON.stringify(action)})`);
  let initial;
  for (let attempt = 0; attempt < 60; attempt++) { try { initial = await evaluate('window.tud.dshPet.getState()'); } catch {} if (initial) break; await wait(250); }
  assert.equal(initial.enabled, false);
  await evaluate(`window.tud.pet.setSettings({visible:true,character:'clawd'})`);
  const testKey = 'local-smoke-only-not-a-real-key';
  await dispatch({ type: 'save-provider', provider: { id: 'mock', name: 'Local packaged mock', baseUrl: `http://127.0.0.1:${api.address().port}/v1`, models: ['smoke'], apiKey: testKey } });
  const redacted = await evaluate('window.tud.dshPet.getState()');
  assert.equal(redacted.models.providers[0].apiKeyConfigured, true); assert.equal(JSON.stringify(redacted).includes(testKey), false);
  assert.equal((await readFile(path.join(directory, 'electron/dsh-pet/models.json'), 'utf8')).includes(testKey), false);
  await dispatch({ type: 'set-default-model', model: { provider: 'mock', model: 'smoke' } });
  const main = initial.config.main;
  await dispatch({ type: 'patch-config', patch: { notificationsEnabled: false, pets: main.pets.map(pet => ({ ...pet, whisperEnabled: false })) } });
  await evaluate(`window.dispatchEvent(new CustomEvent('tud:open-settings', {detail:{tab:'app'}})); true;`);
  await wait(500);
  const section = `[...document.querySelectorAll('section')].find(section => section.getAttribute('aria-label')?.includes('dsh-pet'))`;
  assert.equal(await evaluate(`!!(${section})?.querySelector('input[role="switch"]')`), true, 'the enable control must render an interactive switch input');
  const waitState = async (enabled, status) => {
    let current;
    for (let attempt = 0; attempt < 80; attempt++) {
      current = await evaluate('window.tud.dshPet.getState()');
      const input = await evaluate(`(() => { const input = (${section}).querySelector('input[role="switch"]'); return {checked:input.checked,disabled:input.disabled}; })()`);
      if (current.enabled === enabled && current.status === status && input.checked === enabled && !input.disabled) return current;
      if (current.status === 'error') break;
      await wait(100);
    }
    assert.fail(`Switch did not reach enabled=${enabled}, status=${status}: ${JSON.stringify(current)}`);
  };
  const clickSwitch = async () => {
    const point = await evaluate(`(() => { const control = (${section}).querySelector('[data-slot="switch-control"]'); control.scrollIntoView({block:'center'}); const rect = control.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  await clickSwitch();
  await waitState(true, 'running');
  await wait(5500);
  await evaluate(`(${section}).querySelector('input[role="switch"]').focus(); true;`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await waitState(false, 'disabled');
  await clickSwitch();
  await waitState(true, 'running');
  let state = await evaluate('window.tud.dshPet.getState()'); assert.equal(state.status, 'running', state.error);
  const chat = await dispatch({ type: 'request', method: 'POST', path: '/chat?pet=main', body: '{"text":"Packaged smoke"}' }); assert.equal(JSON.parse(chat.body).ok, true);
  const history = await dispatch({ type: 'request', method: 'GET', path: '/chat?pet=main' }); assert.equal(JSON.parse(history.body).messages.length, 2);
  assert.equal(JSON.parse(history.body).messages[1].content, 'Packaged local mock reply');
  await dispatch({ type: 'patch-config', patch: { pets: [...main.pets.map(pet => ({ ...pet, whisperEnabled: false })), { ...main.pets[0], id: 'second', name: 'Second', size: 200, whisperEnabled: false }] } }); await wait(1200);
  state = await evaluate('window.tud.dshPet.getState()'); assert.equal(state.status, 'running'); assert.equal(state.config.main.pets.length, 2);
  await dispatch({ type: 'set-enabled', enabled: false }); assert.equal((await evaluate('window.tud.dshPet.getState()')).status, 'disabled');
  assert.equal(await evaluate('window.tud.pet.getState().then(s => s.settings.visible)'), true);
  await evaluate('window.tud.pet.setSettings({visible:false})');
  assert.equal(await evaluate('window.tud.pet.getState().then(s => Boolean(s.catalog.length))'), true);
  await evaluate(`window.dispatchEvent(new CustomEvent('tud:open-settings', {detail:{tab:'app'}})); true;`);
  await wait(500);
  assert.equal(await evaluate(`!![...document.querySelectorAll('section')].find(section => section.getAttribute('aria-label')?.includes('dsh-pet'))`), true);
  await evaluate(`[...document.querySelectorAll('section')].find(section => section.getAttribute('aria-label')?.includes('dsh-pet')).scrollIntoView({block:'start'}); true;`);
  const capture = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, 'main.png'), Buffer.from(capture.data, 'base64'));
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, enabledByDefault: initial.enabled, enabledThroughMouse: true, disabledThroughKeyboard: true, reenabledThroughMouse: true, encryptedAndRedactedTestKey: true, chatModel: JSON.parse(chat.body), memoryMessages: 2, reloadInstances: state.config.main.pets.length, existingPetCatalog: true }, null, 2));
  await evaluate('window.tud.quit(); true');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(10_000)]);
  assert.equal(child.exitCode, 0, 'Packaged main must exit normally without forced termination');
  console.log(JSON.stringify({ ok: true, directory }));
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null && evaluate) {
    try { await evaluate('window.tud.quit(); true'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(10_000)]); } catch { /* Fall back only for this smoke's own child. */ }
  }
  client?.close(); if (child.exitCode === null) child.kill(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); await writeFile(path.join(directory, 'stdout.log'), stdout); await writeFile(path.join(directory, 'stderr.log'), stderr);
}
