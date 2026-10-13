import { ipcMain } from 'electron';
import { readCopilotSubscription } from './copilot-subscription';

export const COPILOT_SUBSCRIPTION_GET_CHANNEL = 'copilot-subscription:get';

export function registerCopilotSubscriptionIpc(): () => void {
  ipcMain.removeHandler(COPILOT_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(COPILOT_SUBSCRIPTION_GET_CHANNEL, () => readCopilotSubscription());
  return () => ipcMain.removeHandler(COPILOT_SUBSCRIPTION_GET_CHANNEL);
}
