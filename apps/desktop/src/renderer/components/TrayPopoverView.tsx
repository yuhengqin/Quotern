import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ja, ko, zhCN } from 'date-fns/locale';
import { normalizeLocale, translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { Button } from '@heroui/react';
import { Check } from '@gravity-ui/icons';
import { fetchSyncStatus } from '@/lib/api';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { ThemeToggle } from './ThemeToggle';
import { SubscriptionUsageGrid } from './SubscriptionUsageGrid';
import { AgentActivityList } from '../../../../../packages/dashboard/src/components/AgentActivityPanel';
import {
  TRAY_PANEL_WIDTH,
  TRAY_PANEL_MIN_HEIGHT,
  TRAY_PANEL_MAX_HEIGHT,
  TRAY_PANEL_GUTTER,
} from '../../shared/tray-popover-layout';
import './TrayPopoverView.css';

const POPOVER_SHELL_STYLE = {
  '--tray-panel-width': `${TRAY_PANEL_WIDTH}px`,
  '--tray-panel-max-height': `${TRAY_PANEL_MAX_HEIGHT}px`,
  '--tray-panel-gutter': `${TRAY_PANEL_GUTTER}px`,
} as CSSProperties;

/** Dedicated React surface loaded inside the native tray popover window. */
export function TrayPopoverView() {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage);
  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const lastSentHeight = useRef(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    const openDialogs = new Set<string>();
    const onDialog = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; open: boolean }>).detail;
      if (detail.open) openDialogs.add(detail.id); else openDialogs.delete(detail.id);
      const open = openDialogs.size > 0;
      setDialogOpen(open); void window.tud.setQuotaDialogOpen?.(open).catch(() => {});
    };
    window.addEventListener('quotern:quota-dialog', onDialog);
    return () => { window.removeEventListener('quotern:quota-dialog', onDialog); void window.tud.setQuotaDialogOpen?.(false).catch(() => {}); };
  }, []);

  const reloadSyncStatus = useCallback(async () => {
    try {
      const status = await fetchSyncStatus();
      setLastSyncAt(status.lastSyncAt);
      setNow(Date.now());
    } catch {
      // Keep the last known timestamp if a sync-status request fails.
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void reloadSyncStatus();
    let timer = 0;
    const onSynced = () => {
      if (document.visibilityState === 'hidden') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void reloadSyncStatus(); }, 250);
    };
    // The popover stays mounted while hidden. Refresh when it regains focus.
    const onFocus = () => { void reloadSyncStatus(); };
    window.addEventListener(DATA_SYNCED_EVENT, onSynced);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(DATA_SYNCED_EVENT, onSynced);
      window.removeEventListener('focus', onFocus);
    };
  }, [reloadSyncStatus]);

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (document.visibilityState !== 'hidden') {
        void reloadSyncStatus();
      }
    };
    const timer = window.setInterval(tick, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [reloadSyncStatus]);

  /** Keep the native tray window fitted to the rendered header and content. */
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const measure = () => {
      const header = headerRef.current?.offsetHeight ?? 0;
      const footer = footerRef.current?.offsetHeight ?? 0;
      const natural = dialogOpen ? TRAY_PANEL_MAX_HEIGHT : header + contentEl.offsetHeight + footer;
      const clamped = Math.ceil(
        Math.min(Math.max(natural, TRAY_PANEL_MIN_HEIGHT), TRAY_PANEL_MAX_HEIGHT)
          + TRAY_PANEL_GUTTER * 2,
      );
      if (clamped === lastSentHeight.current) return;
      lastSentHeight.current = clamped;
      window.tud?.resizeTrayPopover?.(clamped);
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(contentEl);
    if (headerRef.current) resizeObserver.observe(headerRef.current);
    if (footerRef.current) resizeObserver.observe(footerRef.current);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [dialogOpen]);

  return (
    <div className="tray-popover font-sans text-foreground" style={POPOVER_SHELL_STYLE}>
      <header
        ref={headerRef}
        className="tray-popover__header flex items-center justify-between px-4 py-2"
      >
        <h1 className="min-w-0 flex-1 py-1 text-sm font-semibold text-foreground">{t('desktop.tray.overview')}</h1>
        <ThemeToggle />
      </header>

      <div className="tray-popover__body">
        <div ref={contentRef} className="px-4 pb-4">
          <SubscriptionUsageGrid className="mb-3 grid-cols-1 gap-2.5" summaryOnly />
          <details onToggle={event => setActivityOpen(event.currentTarget.open)}><summary className="cursor-pointer text-xs text-muted focus-visible:outline-2 focus-visible:outline-accent">{t('experience.activity')}</summary>{activityOpen && <div className="pt-3"><AgentActivityList /></div>}</details>
        </div>
      </div>

      <footer
        ref={footerRef}
        className="tray-popover__footer flex items-center gap-1.5 px-4 py-2"
      >
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center text-success"
        >
          <Check className="size-3" />
        </span>
        <span
          className="min-w-0 truncate text-xs text-muted"
          title={lastSyncAt && Number.isFinite(new Date(lastSyncAt).getTime())
            ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSyncAt))
            : undefined}
        >
          {t('desktop.tray.lastSynced', { time: formatLastSyncTime(lastSyncAt, now, locale) })}
        </span>
        <Button
          type="button"
          className="ml-auto h-8 min-h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs"
          size="sm"
          variant="secondary"
          onPress={() => window.tud?.showMainWindow?.()}
        >
          {t('desktop.tray.openMain')}
          <span aria-hidden="true">↗</span>
        </Button>
      </footer>
    </div>
  );
}

function formatLastSyncTime(lastSyncAt: string | null, now: number, locale: SupportedLocale): string {
  if (!lastSyncAt) return translate(locale, 'desktop.tray.never');
  const date = new Date(lastSyncAt);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return translate(locale, 'desktop.tray.unknown');

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 60) return translate(locale, 'desktop.tray.justNow');

  if (elapsedSeconds < 7 * 24 * 60 * 60) {
    return formatDistanceToNow(date, { addSuffix: true, locale: { 'zh-CN': zhCN, en: enUS, ja, ko }[locale] });
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}
