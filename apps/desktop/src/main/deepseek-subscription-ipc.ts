import { ipcMain } from 'electron';
import { readDeepSeekSubscription } from './deepseek-subscription';

export const DEEPSEEK_SUBSCRIPTION_GET_CHANNEL = 'deepseek-subscription:get';

export function registerDeepSeekSubscriptionIpc(): () => void {
  ipcMain.removeHandler(DEEPSEEK_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(DEEPSEEK_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) =>
    readDeepSeekSubscription(options ?? {}));
  return () => ipcMain.removeHandler(DEEPSEEK_SUBSCRIPTION_GET_CHANNEL);
}
