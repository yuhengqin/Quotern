import { ipcMain } from 'electron';
import { readKimiSubscriptions } from './kimi-subscription';

export const KIMI_SUBSCRIPTION_GET_CHANNEL = 'kimi-subscription:get';

export function registerKimiSubscriptionIpc(): () => void {
  ipcMain.removeHandler(KIMI_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(KIMI_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) =>
    readKimiSubscriptions({ forceRefresh: options?.forceRefresh === true }));
  return () => ipcMain.removeHandler(KIMI_SUBSCRIPTION_GET_CHANNEL);
}
