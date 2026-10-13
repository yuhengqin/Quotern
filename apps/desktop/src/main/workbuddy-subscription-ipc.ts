import { ipcMain } from 'electron';
import { readWorkBuddySubscription } from './workbuddy-subscription';
import type { WorkBuddyRegion } from '../shared/workbuddy-subscription';

export const WORKBUDDY_GLOBAL_SUBSCRIPTION_GET_CHANNEL = 'workbuddy-global-subscription:get';
export const WORKBUDDY_MAINLAND_SUBSCRIPTION_GET_CHANNEL = 'workbuddy-mainland-subscription:get';

function registerWorkBuddyRegionIpc(channel: string, region: WorkBuddyRegion): () => void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (_event, options?: { forceRefresh?: boolean }) =>
    readWorkBuddySubscription(region, options ?? {}));
  return () => ipcMain.removeHandler(channel);
}

export function registerWorkBuddySubscriptionIpc(): () => void {
  const disposeGlobal = registerWorkBuddyRegionIpc(WORKBUDDY_GLOBAL_SUBSCRIPTION_GET_CHANNEL, 'global');
  const disposeMainland = registerWorkBuddyRegionIpc(WORKBUDDY_MAINLAND_SUBSCRIPTION_GET_CHANNEL, 'mainland');
  return () => {
    disposeGlobal();
    disposeMainland();
  };
}
