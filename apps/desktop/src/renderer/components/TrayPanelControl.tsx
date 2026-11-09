import { useEffect, useState } from 'react';
import { Button, Tooltip } from '@heroui/react';
import { PinIcon } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { TrayPanelViewState } from '../../shared/tray-panel';

const unpinned: TrayPanelViewState = { pinned: false, expanded: true };

export function useTrayPanel() {
  const [state, setState] = useState<TrayPanelViewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const bridge = window.tud;
    if (!bridge?.getTrayPanel) {
      setState(unpinned);
      return;
    }
    let active = true;
    let received = false;
    const unsubscribe = bridge.onTrayPanelChanged(next => {
      received = true;
      setState(next);
    });
    void bridge.getTrayPanel().then(next => {
      if (active && !received) setState(next);
    }).catch(() => {
      if (!active || received) return;
      setState(unpinned);
      setError(true);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const update = async (change: () => Promise<TrayPanelViewState>) => {
    if (busy || !state) return;
    setBusy(true);
    setError(false);
    try { setState(await change()); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return {
    state, busy, error,
    togglePinned: () => update(() => window.tud.setTrayPanelPinned(!state?.pinned)),
    toggleExpanded: () => update(() => window.tud.setTrayPanelExpanded(!state?.expanded)),
    toggleMode: () => update(() => window.tud.setTrayPanelMode(state?.mode === 'summary' ? 'full' : 'summary')),
  };
}

export function TrayPanelPinButton({ panel, iconOnly = false }: { panel: ReturnType<typeof useTrayPanel>; iconOnly?: boolean }) {
  const { t } = useTranslation();
  if (!window.tud?.setTrayPanelPinned) return null;
  const pinned = panel.state?.pinned ?? false;
  const label = t(pinned ? 'desktop.tray.unpin' : 'desktop.tray.pin');
  const button = (
    <Button
      aria-label={iconOnly ? label : undefined}
      className={iconOnly ? 'size-8 min-w-8 p-0' : undefined}
      isDisabled={!panel.state}
      isIconOnly={iconOnly}
      isPending={panel.busy}
      onPress={() => { void panel.togglePinned(); }}
      size="sm"
      variant={pinned ? 'secondary' : 'tertiary'}
    >
      {iconOnly ? <PinIcon aria-hidden className="size-4" /> : label}
    </Button>
  );
  return iconOnly ? <Tooltip>{button}<Tooltip.Content placement="bottom">{label}</Tooltip.Content></Tooltip> : button;
}

export function TrayPanelControl() {
  const { t } = useTranslation();
  const panel = useTrayPanel();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TrayPanelPinButton panel={panel} />
      {panel.error && <p role="alert" className="text-xs text-danger">{t('desktop.tray.panelFailed')}</p>}
    </div>
  );
}
