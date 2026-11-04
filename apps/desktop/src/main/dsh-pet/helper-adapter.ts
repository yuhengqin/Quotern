import { connect } from 'node:net';
import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { RpcResponse } from '../../shared/dsh-pet.js';
import { toNativePetMenuTemplate, withDshActions, type PetContextMenu } from '../pet-context-menu.js';

/** Popups belong to the helper's Electron process, not to the host's windows. */
export function installPetContextMenus(
  electron: Pick<typeof import('electron'), 'ipcMain' | 'BrowserWindow' | 'Menu' | 'nativeTheme'>,
  windows: Map<unknown, import('electron').BrowserWindow>,
  host: { request(method: string, url: string, body?: string): Promise<RpcResponse> },
): void {
  const active = new Map<import('electron').BrowserWindow, import('electron').Menu>();
  const requests = new WeakMap<import('electron').BrowserWindow, object>();
  const owner = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || event.senderFrame !== event.sender.mainFrame || ![...windows.values()].includes(win)) throw new Error('Pet menu sender rejected');
    return win;
  };
  electron.ipcMain.handle('pet:context-menu', async (event, tree: unknown) => {
    const win = owner(event);
    const generation = {};
    requests.set(win, generation);
    const response = await host.request('GET', '/dsh-pet-7340/context-menu');
    if (win.isDestroyed() || requests.get(win) !== generation) return null;
    if (response.status !== 200) throw new Error('Pet menu unavailable');
    const model = withDshActions(JSON.parse(response.body ?? '{}') as PetContextMenu, tree);
    electron.nativeTheme.themeSource = model.theme;
    active.get(win)?.closePopup(win);
    return new Promise(resolve => {
      let selected: { command?: string; local?: { action?: string; anim?: string } } | null = null, finished = false;
      const menu = electron.Menu.buildFromTemplate(toNativePetMenuTemplate(model.items, item => {
        selected = item.local ? { local: item.local } : item.command ? { command: item.id } : null;
      }));
      const finish = () => {
        if (finished) return;
        finished = true;
        if (active.get(win) === menu) active.delete(win);
        win.removeListener('closed', finish);
        resolve(selected);
      };
      active.set(win, menu);
      win.once('closed', finish);
      // Electron dispatches the chosen item and close event separately.
      menu.popup({ window: win, callback: () => { setImmediate(finish); } });
    });
  });
  electron.ipcMain.on('pet:context-menu-close', event => {
    try { const win = owner(event); requests.delete(win); active.get(win)?.closePopup(win); } catch { /* Ignore stale frames after helper shutdown. */ }
  });
}

/** Sample local hover coordinates without a Windows low-level mouse hook. */
export function createPointerSampler() {
  let last: { x: number; y: number } | null = null, wasInBody = false, refreshAfterBusy = false;
  return (bounds: { x: number; y: number }, point: { x: number; y: number }, inBody: boolean, busy: boolean): { x: number; y: number } | null => {
    // Real pointer capture owns drag/menu/chat input; samples must never release it.
    if (busy) { last = null; wasInBody = false; refreshAfterBusy = true; return null; }
    const next = { x: point.x - bounds.x, y: point.y - bounds.y };
    const changed = !last || last.x !== next.x || last.y !== next.y || inBody !== wasInBody;
    const publish = refreshAfterBusy || changed && (inBody || wasInBody);
    last = next; wasInBody = inBody; refreshAfterBusy = false;
    return publish ? next : null;
  };
}

export function connectHost(endpoint: string, token: string, onDisconnect: () => void) {
  const socket = connect(endpoint);
  let sequence = 0, pending = Buffer.alloc(0), closed = false;
  const requests = new Map<number, { resolve(value: RpcResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const ready = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.on('error', () => socket.destroy());
  socket.once('close', () => { for (const entry of requests.values()) { clearTimeout(entry.timer); entry.reject(new Error('host disconnected')); } requests.clear(); if (!closed) onDisconnect(); });
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 1024 * 1024) { socket.destroy(); return; }
    for (let end = pending.indexOf(10); end !== -1; end = pending.indexOf(10)) {
      const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
      try { const response = JSON.parse(line.toString('utf8')) as RpcResponse & { id: number }; const entry = requests.get(response.id); if (entry) { requests.delete(response.id); clearTimeout(entry.timer); entry.resolve(response); } } catch { socket.destroy(); }
    }
  });
  return {
    ready,
    async request(method: string, url: string, body?: string): Promise<RpcResponse> {
      await ready; if (socket.destroyed || closed || requests.size >= 64) throw new Error('host unavailable');
      return new Promise((resolve, reject) => {
        const id = ++sequence, message = JSON.stringify({ id, token, method, url, ...(body !== undefined ? { body } : {}) }) + '\n';
        if (Buffer.byteLength(message) > 1024 * 1024) { reject(new Error('request too large')); return; }
        const timer = setTimeout(() => { requests.delete(id); reject(new Error('host request timeout')); }, 65_000); timer.unref();
        requests.set(id, { resolve, reject, timer }); socket.write(message);
      });
    },
    close() { closed = true; socket.destroy(); },
  };
}

/** Media stays off the pipe; stream the selected byte range from the host-approved file. */
export async function fileResponse(file: string, range: string | null, contentType?: string): Promise<Response> {
  const handle = await open(file, 'r'); const size = (await handle.stat()).size; await handle.close();
  const headers: Record<string, string> = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', ...(contentType ? { 'content-type': contentType } : {}) };
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start < 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    status = 206; headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = String(Math.max(0, end - start + 1));
  return new Response(size ? Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array> : null, { status, headers });
}
