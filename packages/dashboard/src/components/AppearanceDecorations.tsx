import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Tooltip } from '@heroui/react';
import { Pause } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { hasAppearanceDecoration, type AppearanceBridge, type AppearanceStyle, type DecoratedAppearanceStyle } from '../../../../apps/desktop/src/shared/appearance';
import { observeDecorationVisibility } from '../lib/appearance-motion';
import './appearance-decorations.css';
import './appearance-messages';

const Artwork = lazy(() => import('./AppearanceArtwork'));
class ArtworkBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Off and static styles create neither artwork nor visibility subscriptions. */
export function AppearanceDecorations({ style, enabled, bridge, onStop, saveError, retry }: {
  style: AppearanceStyle; enabled: boolean; bridge?: AppearanceBridge; onStop: () => void; saveError: boolean; retry: () => void;
}) {
  const { t } = useTranslation();
  const [pauseRequested, setPauseRequested] = useState(false);
  useEffect(() => { if (enabled) setPauseRequested(false); }, [enabled]);
  return <>
    {enabled && hasAppearanceDecoration(style) && <ActiveDecorations key={style} style={style} bridge={bridge} onStop={() => { setPauseRequested(true); onStop(); }} />}
    {pauseRequested && saveError && createPortal(<div className="appearance-motion-notice" role="alert">
      <span>{t('appearance.saveFailed')}</span><Button size="sm" variant="secondary" onPress={retry}>{t('appearance.retry')}</Button>
    </div>, document.querySelector('.tray-popover') ?? document.body)}
  </>;
}

function ActiveDecorations({ style, bridge, onStop }: { style: DecoratedAppearanceStyle; bridge?: AppearanceBridge; onStop: () => void }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.tray-popover') ?? document.body);
    return observeDecorationVisibility({ page: document, motion: window.matchMedia('(prefers-reduced-motion: reduce)'), native: bridge?.onAppearanceVisibilityChanged }, setActive);
  }, [bridge]);
  if (!host || !active) return null;
  const isTray = host.classList.contains('tray-popover');
  return <>
    {createPortal(<div className="appearance-decorations" data-appearance-decoration={style} aria-hidden="true" inert>
      <ArtworkBoundary onError={() => setArtworkFailed(true)}><Suspense fallback={null}><Artwork style={style} /></Suspense></ArtworkBoundary>
    </div>, host)}
    {artworkFailed && createPortal(<div data-appearance-artwork-error className="appearance-motion-notice" role="alert"><span>{t('appearance.artworkFailed')}</span><Button size="sm" variant="secondary" onPress={onStop}>{t('appearance.pause')}</Button></div>, host)}
    {createPortal(<Tooltip><Tooltip.Trigger>
      <Button data-appearance-pause isIconOnly size="sm" variant="secondary" className={isTray ? 'appearance-motion-pause appearance-motion-pause--tray' : 'appearance-motion-pause'} aria-label={t('appearance.pause')} onPress={onStop}><Pause aria-hidden="true" size={14} /></Button>
    </Tooltip.Trigger><Tooltip.Content>{t('appearance.pause')}</Tooltip.Content></Tooltip>, isTray ? host.querySelector<HTMLElement>('.tray-popover__header') ?? host : host)}
  </>;
}
