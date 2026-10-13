import { ipcMain } from 'electron';
import { readOpenCodeSubscription } from './opencode-subscription';

export const OPENCODE_SUBSCRIPTION_GET_CHANNEL = 'opencode-subscription:get';

export function registerOpenCodeSubscriptionIpc(): () => void {
  ipcMain.removeHandler(OPENCODE_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(OPENCODE_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) =>
    readOpenCodeSubscription(options ?? {}));
  return () => ipcMain.removeHandler(OPENCODE_SUBSCRIPTION_GET_CHANNEL);
}
