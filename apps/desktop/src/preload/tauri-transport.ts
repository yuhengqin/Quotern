import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DesktopTransport } from './index';

type Listener = (...args: any[]) => void;
type DesktopEvent = { channel: string; args: unknown[] };

export function createTauriTransport(): { transport: DesktopTransport; ready: Promise<void> } {
  const listeners = new Map<string, Set<Listener>>();
  const ready = listen<DesktopEvent>('desktop-event', ({ payload }: { payload: DesktopEvent }) => {
    if (!payload || typeof payload.channel !== 'string' || !Array.isArray(payload.args)) return;
    for (const listener of listeners.get(payload.channel) ?? []) {
      listener(undefined, ...payload.args);
    }
  }).then(() => undefined);

  const transport: DesktopTransport = {
    invoke: (channel, ...args) => invoke('desktop_request', { channel, args }),
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
