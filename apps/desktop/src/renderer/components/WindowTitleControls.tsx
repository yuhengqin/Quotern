import { Maximize2Icon, Minimize2Icon, MinusIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';

/**
 * Custom title-bar controls for frameless Windows / Linux windows.
 * macOS keeps native traffic lights; hide this component there.
 */
export function WindowTitleControls() {
  const { t } = useTranslation();
  const platform = window.tud?.platform;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!platform || platform === 'darwin') return;
    return window.tud.onMaximized(setIsMaximized);
  }, [platform]);
  if (!platform || platform === 'darwin') return null;

  return (
    <div className="desktop-window-no-drag flex h-full shrink-0 items-stretch">
      <button
        type="button"
        aria-label={t('desktop.window.minimize')}
        className="flex h-full w-11 items-center justify-center text-foreground/70 transition-colors hover:bg-black/8 hover:text-foreground active:bg-black/12 dark:hover:bg-white/10 dark:active:bg-white/14"
        onClick={() => window.tud.minimize()}
      >
        <MinusIcon className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={t(isMaximized ? 'desktop.window.restore' : 'desktop.window.maximize')}
        className="flex h-full w-11 items-center justify-center text-foreground/70 transition-colors hover:bg-black/8 hover:text-foreground active:bg-black/12 dark:hover:bg-white/10 dark:active:bg-white/14"
        onClick={() => window.tud.toggleMaximize()}
      >
        {isMaximized ? (
          <Minimize2Icon className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Maximize2Icon className="size-3.5" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        aria-label={t('desktop.window.close')}
        className="flex h-full w-11 items-center justify-center text-foreground/70 transition-colors hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f] active:text-white"
        onClick={() => window.tud.close()}
      >
        <XIcon className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
