import type { QuotaNavigationTarget } from 'quotern-core/quota/shared/quota';
export type { QuotaNavigationTarget };
export interface QuotaNavigationRequest extends QuotaNavigationTarget { requestId: string }
export const QUOTA_NAVIGATION = 'quota:navigation';
export const QUOTA_NAVIGATION_GET = 'quota:navigation:get';
export const QUOTA_NAVIGATION_ACK = 'quota:navigation:ack';
export const QUOTA_DIALOG_STATE = 'quota:dialog-state';
