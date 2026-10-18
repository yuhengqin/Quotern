import { useEffect, useLayoutEffect, useRef } from 'react';

type DashboardReturnState = {
  selectedDate: string | null;
  selectedTools: string[];
  scrollTop: number;
};

let returnState: DashboardReturnState | null = null;
let leavingDashboard = false;

export function getDashboardReturnState(): DashboardReturnState | null {
  return returnState;
}

export function saveDashboardFilters(selectedDate: string | null, selectedTools: string[]): void {
  returnState = {
    selectedDate,
    selectedTools: [...selectedTools],
    scrollTop: returnState?.scrollTop ?? 0,
  };
}

function scrollContainer(): HTMLElement | Window {
  return document.querySelector<HTMLElement>('[data-dashboard-scroll-container]') ?? window;
}

function scrollTop(container: HTMLElement | Window): number {
  return container === window ? window.scrollY : (container as HTMLElement).scrollTop;
}

export function rememberDashboardScroll(selectedDate: string | null, selectedTools: string[]): void {
  saveDashboardFilters(selectedDate, selectedTools);
  if (returnState) returnState.scrollTop = scrollTop(scrollContainer());
  leavingDashboard = true;
}

export function useDashboardReturnState(
  selectedDate: string | null,
  selectedTools: string[],
  loading: boolean,
): void {
  const pendingScroll = useRef(returnState?.scrollTop ?? 0);
  const restoring = useRef(pendingScroll.current > 0);

  useEffect(() => {
    saveDashboardFilters(selectedDate, selectedTools);
  }, [selectedDate, selectedTools]);

  useEffect(() => {
    leavingDashboard = false;
    const container = scrollContainer();
    const onScroll = () => {
      if (returnState && !restoring.current && !leavingDashboard) returnState.scrollTop = scrollTop(container);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (loading || !restoring.current) return;
    const target = pendingScroll.current;
    const container = scrollContainer();
    let frame = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        container.scrollTo({ top: target, behavior: 'instant' });
      });
    };
    const observer = new ResizeObserver(restore);
    const page = document.querySelector('.dashboard-page');
    if (page) observer.observe(page);
    const finish = () => {
      window.clearTimeout(timer);
      observer.disconnect();
      cancelAnimationFrame(frame);
      container.removeEventListener('wheel', finish);
      container.removeEventListener('touchstart', finish);
      document.removeEventListener('keydown', finish);
      restoring.current = false;
      if (returnState) returnState.scrollTop = scrollTop(container);
    };
    const timer = window.setTimeout(finish, 1500);
    container.addEventListener('wheel', finish, { passive: true });
    container.addEventListener('touchstart', finish, { passive: true });
    document.addEventListener('keydown', finish);
    restore();
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      container.removeEventListener('wheel', finish);
      container.removeEventListener('touchstart', finish);
      document.removeEventListener('keydown', finish);
      cancelAnimationFrame(frame);
    };
  }, [loading]);
}
