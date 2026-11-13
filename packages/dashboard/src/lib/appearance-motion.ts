interface Observable {
  addEventListener: (name: string, listener: () => void) => void;
  removeEventListener: (name: string, listener: () => void) => void;
}
interface MotionSources {
  page: Observable & { readonly hidden: boolean };
  motion: Observable & { readonly matches: boolean };
  native?: (listener: (visible: boolean) => void) => () => void;
}

/** No timers or frame loop: one subscription, disposed when decorations are off. */
export function observeDecorationVisibility({ page, motion, native }: MotionSources, onChange: (active: boolean) => void): () => void {
  let disposed = false, nativeVisible = !native;
  const publish = () => { if (!disposed) onChange(!page.hidden && !motion.matches && nativeVisible); };
  page.addEventListener('visibilitychange', publish);
  motion.addEventListener('change', publish);
  const unsubscribe = native?.(visible => { nativeVisible = visible; publish(); });
  publish();
  return () => {
    if (disposed) return;
    disposed = true;
    page.removeEventListener('visibilitychange', publish);
    motion.removeEventListener('change', publish);
    unsubscribe?.();
  };
}
