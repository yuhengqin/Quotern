export * from 'quotern-core/quota/shared/subscription-channels';

import {
  SUBSCRIPTION_CHANNEL_VISIBILITY_EVENT,
  SUBSCRIPTION_CHANNEL_VISIBILITY_KEY,
  isSubscriptionChannelVisibility,
  type SubscriptionChannelVisibility,
} from 'quotern-core/quota/shared/subscription-channels';

export function readSubscriptionChannelVisibility(): SubscriptionChannelVisibility {
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_CHANNEL_VISIBILITY_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    return isSubscriptionChannelVisibility(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSubscriptionChannelVisibility(
  visibility: SubscriptionChannelVisibility,
): void {
  try {
    localStorage.setItem(
      SUBSCRIPTION_CHANNEL_VISIBILITY_KEY,
      JSON.stringify(visibility),
    );
  } catch {
    // ignore private mode / quota
  }
  window.dispatchEvent(
    new CustomEvent(SUBSCRIPTION_CHANNEL_VISIBILITY_EVENT),
  );
}
