import { BrowserWindow, shell } from 'electron';
import { isReferencePricingUrl, isReferenceSessionUrl } from './reference-pricing-url.js';
import { titleBarOverlayFor, windowChromeFor, type WindowChromeTheme } from './window-chrome.js';
import { appearanceChrome, type AppearanceStyle } from '../shared/appearance.js';

const referenceWindows = new WeakSet<BrowserWindow>();
type ReferenceOptions = { preloadPath: string; theme: WindowChromeTheme; appearanceStyle?: AppearanceStyle };
const windowOptions = new WeakMap<BrowserWindow, ReferenceOptions>();

export function isReferencePricingWindow(window: BrowserWindow): boolean {
  return referenceWindows.has(window);
}

/** Preserve the session page while opening a trusted, IPC-enabled reference page. */
export function installReferencePricingLinks(window: BrowserWindow, options: ReferenceOptions): void {
  windowOptions.set(window, options);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isReferencePricingUrl(url, window.webContents.getURL()) && !isReferenceSessionUrl(url, window.webContents.getURL())) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow', overrideBrowserWindowOptions: {
      width: 1024, height: 780, minWidth: 800, minHeight: 600,
      ...windowChromeFor(process.platform, options.theme, options.appearanceStyle),
      show: false, autoHideMenuBar: true, title: 'Quotern',
      backgroundColor: appearanceChrome(options.theme, options.appearanceStyle ?? 'default').background,
      webPreferences: { preload: options.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
    } };
  });
  window.webContents.on('did-create-window', child => {
    referenceWindows.add(child);
    installReferencePricingLinks(child, options);
    child.once('ready-to-show', () => child.show());
    const sendMaximized = () => child.webContents.send('window:is-maximized', child.isMaximized());
    child.on('maximize', sendMaximized);
    child.on('unmaximize', sendMaximized);
  });
}

/** Keep future references and existing native title bars aligned with the app theme. */
export function updateReferencePricingTheme(parent: BrowserWindow, theme: WindowChromeTheme, style: AppearanceStyle = 'default'): void {
  const options = windowOptions.get(parent);
  if (options) { options.theme = theme; options.appearanceStyle = style; }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!isReferencePricingWindow(window)) continue;
    const childOptions = windowOptions.get(window);
    if (childOptions) { childOptions.theme = theme; childOptions.appearanceStyle = style; }
    window.setBackgroundColor(appearanceChrome(theme, style).background);
    if (process.platform === 'win32') window.setTitleBarOverlay(titleBarOverlayFor(theme, style));
  }
}
