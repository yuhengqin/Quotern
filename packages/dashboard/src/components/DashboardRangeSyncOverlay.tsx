import { Spinner } from '@heroui/react';

/** Centered loading indicator while range-driven dashboard refresh runs. */
export function DashboardRangeSyncOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div aria-busy="true" className="absolute inset-0 z-10 bg-background/40">
      <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner aria-hidden="true" className="motion-reduce:animate-none" size="lg" />
          <p className="text-center text-sm text-muted">正在加载用量数据…</p>
        </div>
      </div>
    </div>
  );
}
