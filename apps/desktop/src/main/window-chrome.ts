/**
 * Platform-specific window chrome configuration for the Electron main process.
 *
 * This module is intentionally pure: it has no Electron runtime imports (and no
 * side effects), so it can be unit tested under plain Node with `node:test`.
 *
 * Platform split:
 *  - Windows: Electron's official "hidden title bar + Window Controls Overlay"
 *    mode. The frame stays enabled (never `frame: false`) so Windows keeps the
 *    native caption buttons, Snap Layouts on the maximize button, the system
 *    menu on right-click, and native double-click-to-maximize. The native
 *    buttons paint over the trailing `WINDOW_CONTROLS_OVERLAY_WIDTH` px of the
 *    renderer's 32 px title strip, which stays empty there — the renderer keeps
 *    that area free instead of drawing its own controls.
 *  - macOS: native traffic lights stay visible, vertically centered in the
 *    `TITLEBAR_HEIGHT` strip.
 *  - Linux: frameless window; the renderer keeps drawing its own window
 *    controls, as before.
 */
import { TITLEBAR_HEIGHT } from '../shared/window-chrome.js';

export type WindowChromeTheme = 'light' | 'dark';

/**
 * Window / overlay background colors, shared with the renderer theme so the
 * Window Controls Overlay strip blends into the app surface.
 */
export const WINDOW_BACKGROUND_COLORS: Record<WindowChromeTheme, string> = {
  dark: '#050607',
  light: '#f5f5f5',
};

/**
 * Window Controls Overlay colors per theme. `color` must match the window
 * background (`WINDOW_BACKGROUND_COLORS`) so the native strip is seamless;
 * `symbolColor` is the caption glyph color and is chosen for contrast
 * (dark glyphs on the light surface, light glyphs on the dark surface).
 */
export const WINDOW_CONTROLS_OVERLAY_COLORS: Record<
  WindowChromeTheme,
  { color: string; symbolColor: string }
> = {
  dark: { color: WINDOW_BACKGROUND_COLORS.dark, symbolColor: '#d7dce2' },
  light: { color: WINDOW_BACKGROUND_COLORS.light, symbolColor: '#1f2328' },
};

/** Subset of `BrowserWindowConstructorOptions` that this module decides. */
export interface WindowChromeOptions {
  frame?: boolean;
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset';
  titleBarOverlay?: { color: string; symbolColor: string; height: number };
  trafficLightPosition?: { x: number; y: number };
}

/** The native Window Controls Overlay configuration for one theme. */
export function titleBarOverlayFor(theme: WindowChromeTheme): {
  color: string;
  symbolColor: string;
  height: number;
} {
  const colors = WINDOW_CONTROLS_OVERLAY_COLORS[theme];
  return {
    color: colors.color,
    symbolColor: colors.symbolColor,
    height: TITLEBAR_HEIGHT,
  };
}

/**
 * Window chrome options for the given platform and theme.
 *
 * Windows intentionally omits `frame`, which keeps the native frame/caption
 * buttons alive — `titleBarStyle: 'hidden'` only hides the title bar itself and
 * lets the overlay render the controls.
 */
export function windowChromeFor(
  platform: NodeJS.Platform,
  theme: WindowChromeTheme,
): WindowChromeOptions {
  // macOS traffic lights are 12 DIP tall; center them in the title strip.
  const trafficLightY = (TITLEBAR_HEIGHT - 12) / 2;

  switch (platform) {
    case 'darwin':
      return {
        frame: true,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 12, y: trafficLightY },
      };
    case 'win32':
      return {
        // No `frame: false`: the native caption buttons / system menu live on.
        titleBarStyle: 'hidden',
        titleBarOverlay: titleBarOverlayFor(theme),
      };
    case 'linux':
      // The renderer draws minimize / maximize / close on Linux.
      return { frame: false };
    default:
      // Unknown desktop platform: fall back to the renderer-drawn chrome.
      return { frame: false };
  }
}
