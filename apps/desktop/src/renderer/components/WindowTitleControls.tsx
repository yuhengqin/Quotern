import { Maximize2Icon, MinusIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';

/**
 * Caption-button shell shared by the three Linux controls.
 *
 * Width is 46 CSS px (keep in sync with `WINDOW_CONTROLS_BUTTON_WIDTH` in
 * `shared/window-chrome.ts`) and the height is stretched to the title strip, so
 * the buttons sit flush against the top-right corner with no margin.
 *
 * The global `* { outline: none }` rule in `index.css` removes the browser's
 * default focus ring, so every button must draw its own focus-visible cue.
 */
const CAPTION_BUTTON_CLASS =
  'flex h-full w-[46px] shrink-0 items-center justify-center text-foreground/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px]';

/** Hover/pressed feedback for minimize and maximize. */
const NEUTRAL_HOVER_CLASS =
  'hover:bg-black/8 hover:text-foreground active:bg-black/12 dark:hover:bg-white/10 dark:active:bg-white/14';

/** Keyboard focus cue: neutral fill plus a high-contrast inset ring. */
const NEUTRAL_FOCUS_CLASS =
  'focus-visible:bg-black/10 focus-visible:text-foreground focus-visible:outline-black/50 dark:focus-visible:bg-white/14 dark:focus-visible:outline-white/60';

/**
 * Windows 11-style "restore" glyph: two offset square outlines (the back one is
 * clipped by the front one). Drawn inline instead of lucide `Minimize2`, which
 * reads as "minimize", so the 14 px optical size and ~1.6 stroke stay under our
 * control and match the other caption icons.
 */
function RestoreIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/**
 * Renderer-drawn title-bar controls, Linux only.
 *
 * - Windows: the main process enables the native Window Controls Overlay, which
 *   paints the caption buttons over the renderer's 32 px drag strip.
 * - macOS: native traffic lights stay visible.
 *
 * Both platforms therefore render nothing and never subscribe to maximize
 * state; only the frameless Linux window mirrors the OS state into its icon.
 */
export function WindowTitleControls() {
  const { t } = useTranslation();
  const platform = window.tud?.platform;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (platform !== 'linux') return;
    return window.tud.onMaximized(setIsMaximized);
  }, [platform]);

  if (platform !== 'linux') return null;

  return (
    <div className="desktop-window-no-drag flex h-full shrink-0 items-stretch">
      <button
        type="button"
        aria-label={t('desktop.window.minimize')}
        className={`${CAPTION_BUTTON_CLASS} ${NEUTRAL_HOVER_CLASS} ${NEUTRAL_FOCUS_CLASS}`}
        onClick={() => window.tud.minimize()}
      >
        <MinusIcon className="size-3.5" strokeWidth={1.6} />
      </button>
      <button
        type="button"
        aria-label={t(isMaximized ? 'desktop.window.restore' : 'desktop.window.maximize')}
        className={`${CAPTION_BUTTON_CLASS} ${NEUTRAL_HOVER_CLASS} ${NEUTRAL_FOCUS_CLASS}`}
        onClick={() => window.tud.toggleMaximize()}
      >
        {isMaximized ? (
          <RestoreIcon />
        ) : (
          <Maximize2Icon className="size-3.5" strokeWidth={1.6} />
        )}
      </button>
      <button
        type="button"
        aria-label={t('desktop.window.close')}
        className={`${CAPTION_BUTTON_CLASS} hover:bg-[#C42B1C] hover:text-white active:bg-[#B22A1E] active:text-white focus-visible:bg-[#C42B1C] focus-visible:text-white focus-visible:outline-white`}
        onClick={() => window.tud.close()}
      >
        <XIcon className="size-3.5" strokeWidth={1.6} />
      </button>
    </div>
  );
}
