import { ipcMain } from 'electron';
import { readMiniMaxSubscription } from './minimax-subscription';

export const MINIMAX_SUBSCRIPTION_GET_CHANNEL = 'minimax-subscription:get';

export function registerMiniMaxSubscriptionIpc(): () => void {
  ipcMain.removeHandler(MINIMAX_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(MINIMAX_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) =>
    readMiniMaxSubscription(options ?? {}));
  return () => ipcMain.removeHandler(MINIMAX_SUBSCRIPTION_GET_CHANNEL);
}
