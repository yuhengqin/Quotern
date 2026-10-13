import { ipcMain } from 'electron';
import { readCodexSubscription } from './codex-subscription';

export const CODEX_SUBSCRIPTION_GET_CHANNEL = 'codex-subscription:get';

export function registerCodexSubscriptionIpc(): () => void {
  ipcMain.removeHandler(CODEX_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(CODEX_SUBSCRIPTION_GET_CHANNEL, (_event, options: unknown) => {
    const input = options && typeof options === 'object' ? options as Record<string, unknown> : {};
    return readCodexSubscription({ forceRefresh: input.forceRefresh === true });
  });
  return () => ipcMain.removeHandler(CODEX_SUBSCRIPTION_GET_CHANNEL);
}
