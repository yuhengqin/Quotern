/**
 * Window chrome geometry shared by the Electron main process and the renderer.
 *
 * The frameless title-bar strip is `TITLEBAR_HEIGHT` CSS px tall. On Windows the
 * same value is used as the native Window Controls Overlay height, so the native
 * caption buttons line up exactly with the renderer-owned drag strip.
 *
 * Keep this module free of Electron imports: the renderer bundles it.
 */
export const TITLEBAR_HEIGHT = 32;

/** Width of one native caption button on Windows 11 at 100% scaling (DIP). */
export const WINDOW_CONTROLS_BUTTON_WIDTH = 46;

/** Total width occupied by the three native caption buttons (DIP). */
export const WINDOW_CONTROLS_OVERLAY_WIDTH = WINDOW_CONTROLS_BUTTON_WIDTH * 3;
