import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import {
  getUpdateToolbarAction,
  PORTABLE_RELEASES_URL,
  updateDownloadPercent,
  type AutoUpdateState,
} from '../../shared/auto-update';
import { resolveAutoUpdateStateForUi } from '@/lib/mock-portable-update';

/** Keep frequent download progress updates local to the toolbar button. */
export function AutoUpdateAction({ className }: { className: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AutoUpdateState | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const requestPending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let receivedEvent = false;
    const unsubscribe = window.tud.onAutoUpdateStateChanged((next) => {
      receivedEvent = true;
      if (!cancelled) {
        setState(resolveAutoUpdateStateForUi(next));
        setActionError(null);
      }
    });
    void window.tud
      .getAutoUpdateState()
      .then((next) => {
        if (!cancelled && !receivedEvent) setState(resolveAutoUpdateStateForUi(next));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const action = getUpdateToolbarAction(state);
  if (!action) return null;

  const label = state?.status === 'available'
    ? t('desktop.update.available')
    : state?.status === 'downloading'
      ? state.percent == null
        ? t('desktop.update.downloading')
        : t('desktop.update.downloadPercent', { percent: updateDownloadPercent(state.percent) })
      : state?.status === 'downloaded'
        ? t('desktop.update.install')
        : state?.status === 'installing'
          ? t('desktop.update.installing')
          : t('desktop.update.retry');
  const tip =
    actionError ? t(actionError)
      : state?.status !== 'error' && state?.version ? t('desktop.update.toVersion', { version: state.version })
        : label;

  const runAction = async () => {
    if (!action.request || requestPending.current) return;
    requestPending.current = true;
    setPending(true);
    setActionError(null);
    try {
      switch (action.request) {
        case 'install':
          await window.tud.installDownloadedUpdate();
          break;
        case 'check':
          setState(resolveAutoUpdateStateForUi(await window.tud.checkForUpdates()));
          break;
        case 'open-releases': {
          const result = await window.tud.openExternal(PORTABLE_RELEASES_URL);
          if (!result.ok) {
            setActionError('desktop.update.openFailed');
          }
          break;
        }
      }
    } catch {
      setActionError('desktop.update.actionFailed');
    } finally {
      requestPending.current = false;
      setPending(false);
    }
  };

  // Native `title` and HeroUI Tooltip are unreliable on this Electron chrome row;
  // keep a local hover bubble instead.
  return (
    <div
      className="desktop-window-no-drag relative inline-flex"
      onMouseEnter={() => setTipOpen(true)}
      onMouseLeave={() => setTipOpen(false)}
    >
      <button
        aria-busy={pending || !action.request}
        aria-label={tip}
        className={className}
        disabled={pending || !action.request}
        onClick={() => {
          void runAction();
        }}
        type="button"
      >
        {actionError ? t('desktop.update.retry') : label}
      </button>
      {tipOpen ? (
        <div
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-max max-w-64 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] leading-snug text-background shadow-md"
          role="tooltip"
        >
          {tip}
        </div>
      ) : null}
    </div>
  );
}
