import { Toast, type ToastContentValue, type ToastQueue } from '@heroui/react';

/** Shared presentation for application and local top-end feedback queues. */
export function AppToastRegion({
  queue,
}: {
  queue: ToastQueue<ToastContentValue>;
}) {
  return (
    <Toast.Provider
      className="app-toast-region"
      placement="top end"
      queue={queue}
      width="min(24rem, calc(100vw - 2rem))"
    />
  );
}
