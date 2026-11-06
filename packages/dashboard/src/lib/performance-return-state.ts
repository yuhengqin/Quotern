import { useLayoutEffect, useRef } from 'react';
import type { PerformanceSearch } from './performance-page';

let saved: { key: string; top: number; samples: number } | undefined;
const container = () => document.querySelector<HTMLElement>('[data-dashboard-scroll-container]');
export function rememberPerformanceScroll(search: PerformanceSearch) {
  saved = { key: JSON.stringify(search), top: container()?.scrollTop ?? window.scrollY,
    samples: document.querySelector<HTMLElement>('[data-performance-samples]')?.scrollTop ?? 0 };
}
export function usePerformanceReturnScroll(search: PerformanceSearch, ready: boolean) {
  const pending = useRef(saved?.key === JSON.stringify(search) ? saved : undefined);
  useLayoutEffect(() => {
    if (!ready || !pending.current) return;
    const state = pending.current;
    const frame = requestAnimationFrame(() => {
      (container() ?? window).scrollTo({ top: state.top, behavior: 'instant' });
      document.querySelector<HTMLElement>('[data-performance-samples]')?.scrollTo({ top: state.samples });
      pending.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
