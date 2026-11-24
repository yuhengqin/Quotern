import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DesktopTransport } from './index';
import { BACKUP_ROUTE, BACKUP_TRANSFER, backupChunk } from '../shared/backup-transfer';

type Listener = (...args: any[]) => void;
type DesktopEvent = { channel: string; args: unknown[] };

function requestNative<T>(channel: string, args: unknown[]): Promise<T> {
  return invoke('desktop_request', { channel, args });
}

async function requestBackup(body: string, headers?: Record<string, string>) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const send = <T>(op: string, fields: Record<string, unknown> = {}) =>
    requestNative<T>(BACKUP_TRANSFER, [{ id, op, ...fields }]);
  await send('open', { length: body.length, headers });
  try {
    for (let offset = 0; offset < body.length;) {
      const text = backupChunk(body, offset);
      const next = await send<number>('write', { offset, text });
      if (next !== offset + text.length) throw new Error('Invalid backup upload acknowledgement');
      offset = next;
    }
    const size = await send<number>('execute');
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid backup response size');
    const chunks: string[] = [];
    for (let offset = 0; offset < size;) {
      const text = await send<string>('read', { offset });
      if (typeof text !== 'string' || !text.length || offset + text.length > size) throw new Error('Invalid backup response chunk');
      chunks.push(text);
      offset += text.length;
    }
    return JSON.parse(chunks.join(''));
  } finally {
    await send('close').catch(() => { console.warn('Could not release the desktop backup transfer'); });
  }
}

export function createTauriTransport(): { transport: DesktopTransport; ready: Promise<void> } {
  const listeners = new Map<string, Set<Listener>>();
  const ready = listen<DesktopEvent>('desktop-event', ({ payload }: { payload: DesktopEvent }) => {
    if (!payload || typeof payload.channel !== 'string' || !Array.isArray(payload.args)) return;
    for (const listener of listeners.get(payload.channel) ?? []) {
      listener(undefined, ...payload.args);
    }
  }).then(() => undefined);

  const transport: DesktopTransport = {
    invoke: (channel, ...args) => {
      if (channel === 'tud:api-request' && typeof args[0] === 'string' &&
          args[0].split('?')[0] === BACKUP_ROUTE && typeof args[1]?.method === 'string' &&
          args[1].method.toUpperCase() === 'POST' && typeof args[1].body === 'string') {
        return requestBackup(args[1].body, args[1].headers);
      }
      return requestNative(channel, args);
    },
    send: (channel, ...args) => {
      void invoke('desktop_request', { channel, args }).catch((error: unknown) => {
        console.error(`Desktop request failed: ${channel}`, error);
      });
    },
    on: (channel, listener) => {
      let channelListeners = listeners.get(channel);
      if (!channelListeners) {
        channelListeners = new Set();
        listeners.set(channel, channelListeners);
      }
      channelListeners.add(listener);
    },
    removeListener: (channel, listener) => {
      const channelListeners = listeners.get(channel);
      channelListeners?.delete(listener);
      if (channelListeners?.size === 0) listeners.delete(channel);
    },
  };
  return { transport, ready };
}
