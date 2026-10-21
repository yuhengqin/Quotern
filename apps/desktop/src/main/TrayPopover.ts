import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  screen,
  type MenuItemConstructorOptions,
} from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import type { QuotaState } from '../shared/quota';
import type { SupportedLocale } from 'quotern-i18n';
import { quotaPopoverBounds, quotaTraySummary } from './tray-quota';
import { nativeText } from './native-messages';
import { defaultPreloadPath, resolveAppIconPath } from './DesktopWindow';
import {
  TRAY_WINDOW_WIDTH as POPOVER_WIDTH,
  TRAY_WINDOW_MIN_HEIGHT as POPOVER_MIN_HEIGHT,
  TRAY_WINDOW_MAX_HEIGHT as POPOVER_MAX_HEIGHT,
} from '../shared/tray-popover-layout';
import { pokeSyncOnForeground } from './local-runtime';
import {
  markTrayPopoverQuitting,
  shouldTrayPopoverPreventClose,
} from './tray-popover-quit-state';

export { markTrayPopoverQuitting, resetTrayPopoverQuitting } from './tray-popover-quit-state';

/**
 * TrayPopover
 *
 * Cross-platform system tray / menu-bar icon.
 *
 * 设计要点：
 *  - 全平台创建 Tray；关窗后进程靠托盘保活，右键菜单提供「显示主窗口」「同步数据」「退出」。
 *  - macOS：左键切换 Popover；右键手动 popUpContextMenu（不可 setContextMenu，
 *    否则 Electron 会让左键也弹菜单）。图标用 Template Image（`quoternTemplate.png`）。
 *  - Windows：左键切换额度面板；Linux 左键显示主窗口。右键保留主窗口菜单。
 *  - Popover 是独立无边框 BrowserWindow，通过 tray.getBounds()
 *    定位；失焦自动隐藏。
 *  - 应用退出时清理 tray 与窗口，避免残留。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isMac = process.platform === 'darwin';

const TRAY_POPOVER_RESIZE_CHANNEL = 'tray-popover:resize';

/** Initial height; the renderer reports its real content height on first paint. */
const POPOVER_INITIAL_HEIGHT = POPOVER_MIN_HEIGHT;

export interface TrayPopoverOptions {
  getLocale: () => SupportedLocale;
  showMainWindow: () => void;
  openSettings: () => void;
  /** Same as in-app「同步数据」→ POST tud-trigger-sync. */
  triggerSync: () => void;
  /** Windows desktop pet toggle. */
  togglePet?: () => void;
  getDshPetMenu?: () => MenuItemConstructorOptions[];
  onOpen?: () => void;
}

let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let currentOptions: TrayPopoverOptions | null = null;
let lastQuotaState: QuotaState | null = null;
let popover: BrowserWindow | null = null;
let lastHiddenAt = 0;
let iconGeneration = 0;
let quotaLevel = -1;
/** Latest content height reported by the renderer, used when re-anchoring. */
let popoverHeight = POPOVER_INITIAL_HEIGHT;

function resolveTrayIconPath(): string {
  const file = isMac ? 'quoternTemplate.png' : 'icon.png';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', file);
  }
  if (isMac) {
    return path.join(app.getAppPath(), 'resources', file);
  }
  return resolveAppIconPath();
}

function loadTrayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(resolveTrayIconPath());
  if (img.isEmpty()) {
    console.warn('[tud-desktop] tray icon not found, using empty image');
    return img;
  }
  if (isMac) {
    img.setTemplateImage(true);
  }
  return img;
}

function buildTrayMenu(options: TrayPopoverOptions): Menu {
  const locale = options.getLocale();
  return Menu.buildFromTemplate([
    {
      label: nativeText(locale, 'native.tray.showMain'),
      click: () => options.showMainWindow(),
    },
    {
      label: nativeText(locale, 'native.tray.sync'),
      click: () => options.triggerSync(),
    },
    ...(!isMac && options.togglePet ? [{
      label: nativeText(locale, 'native.tray.togglePet'),
      click: () => options.togglePet?.(),
    }] : []),
    ...(options.getDshPetMenu?.() ?? []),
    {
      label: nativeText(locale, 'native.tray.settings'),
      click: () => options.openSettings(),
    },
    { type: 'separator' },
    {
      label: nativeText(locale, 'native.tray.quit'),
      click: () => app.quit(),
    },
  ]);
}

function ensurePopover(): BrowserWindow {
  if (popover && !popover.isDestroyed()) return popover;

  popover = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_INITIAL_HEIGHT,
    minWidth: POPOVER_WIDTH,
    maxWidth: POPOVER_WIDTH,
    minHeight: POPOVER_INITIAL_HEIGHT,
    maxHeight: POPOVER_INITIAL_HEIGHT,
    show: false,
    frame: false,
    fullscreenable: false,
    // The renderer paints the rounded shell; an opaque native backing would
    // fill its corners. Keep transparency stable across renderer theme changes.
    transparent: true,
    backgroundColor: '#00000000',
    // Transparent windows must not be user-resizable. Programmatic setBounds
    // still works; positionPopoverNearTray unlocks the min/max bounds first.
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: defaultPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popover.webContents.on('context-menu', (e) => e.preventDefault());
  popover.on('blur', () => { lastHiddenAt = Date.now(); popover?.hide(); });
  popover.webContents.on('before-input-event', (_event, input) => { if (input.key === 'Escape') { lastHiddenAt = Date.now(); popover?.hide(); } });
  popover.on('close', (e) => {
    // Hide instead of destroy on user close to allow re-toggling.
    if (shouldTrayPopoverPreventClose()) {
      e.preventDefault();
      popover?.hide();
    }
  });

  void loadPopoverRenderer(popover);

  return popover;
}

async function loadPopoverRenderer(window: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    const url = new URL(devUrl);
    url.searchParams.set('view', 'tray-popover');
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(path.join(__dirname, '../renderer/index.html'), {
    search: '?view=tray-popover',
  });
}

/**
 * Anchor the popover to the tray icon at `height`.
 *
 * Called both on show and whenever the renderer reports a new content height,
 * so a growing popover stays pinned under the tray icon instead of drifting or
 * spilling off the bottom of the work area.
 */
function positionPopoverNearTray(t: Tray, height: number): void {
  if (!popover) return;
  const bounds = t.getBounds();
  const display = screen.getDisplayNearestPoint(bounds.width || bounds.height ? {
    x: bounds.x,
    y: bounds.y,
  } : screen.getCursorScreenPoint());
  const work = display.workArea;
  const target = quotaPopoverBounds(bounds, work, POPOVER_WIDTH, height);
  popover.setMinimumSize(target.width, Math.min(POPOVER_MIN_HEIGHT, target.height));
  popover.setMaximumSize(target.width, POPOVER_MAX_HEIGHT);
  popover.setBounds(target);
  popover.setMinimumSize(target.width, target.height);
  popover.setMaximumSize(target.width, target.height);
}

function handlePopoverResize(
  event: Electron.IpcMainEvent,
  rawHeight: unknown,
): void {
  if (!popover || popover.isDestroyed() || !tray) return;
  // Only the popover's own contents may drive its bounds.
  if (event.sender !== popover.webContents) return;

  const height = Number(rawHeight);
  if (!Number.isFinite(height)) return;

  const clamped = Math.round(
    Math.min(Math.max(height, POPOVER_MIN_HEIGHT), POPOVER_MAX_HEIGHT),
  );
  if (clamped === popoverHeight) return;
  popoverHeight = clamped;
  positionPopoverNearTray(tray, clamped);
}

function togglePopover(): void {
  if (!tray) return;
  if (Date.now() - lastHiddenAt < 200) return;
  const w = ensurePopover();
  if (w.isVisible()) {
    w.hide();
    return;
  }
  pokeSyncOnForeground();
  positionPopoverNearTray(tray, popoverHeight);
  w.show();
  w.focus();
}

/** Hide the macOS tray popover if visible (e.g. before focusing the main window). */
export function hideTrayPopover(): void {
  if (!popover || popover.isDestroyed() || !popover.isVisible()) return;
  popover.hide();
}

/**
 * Set the text displayed beside the tray icon in the macOS menu bar.
 * Uses monospaced digits to prevent jitter when usage numbers tick up.
 */
export function setTrayUsageTitle(text: string): void {
  if (!tray || tray.isDestroyed() || !isMac) return;
  const title = text.trim() ? ` ${text.trim()}` : '';
  tray.setTitle(title, { fontType: 'monospacedDigit' });
}

export function setTrayQuotaState(state: QuotaState): void {
  lastQuotaState = state;
  if (!tray || tray.isDestroyed()) return;
  const locale = currentOptions?.getLocale() ?? 'zh-CN';
  const summary = quotaTraySummary(state.providers, locale);
  const incidents = state.providers.filter(provider => provider.service && !provider.service.stale && !['operational', 'unknown'].includes(provider.service.level)).map(provider => nativeText(locale, 'native.tray.serviceIssue', { provider: provider.label }));
  tray.setToolTip(['Quotern', ...incidents, summary.text].join('\n').slice(0, 127));
  if (isMac || quotaLevel === summary.level) return;
  quotaLevel = summary.level;
  const generation = ++iconGeneration;
  const base = loadTrayIcon();
  if (!summary.level) { tray.setImage(base); return; }
  const color = summary.level === 2 ? '#ef4444' : '#f59e0b';
  const badge = Buffer.from(`<svg width="32" height="32"><circle cx="25" cy="25" r="7" fill="${color}" stroke="white" stroke-width="2"/></svg>`);
  void sharp(base.toPNG()).resize(32, 32).composite([{ input: badge }]).png().toBuffer().then(buffer => {
    if (generation === iconGeneration && tray && !tray.isDestroyed()) tray.setImage(nativeImage.createFromBuffer(buffer));
  }).catch(() => { if (generation === iconGeneration) quotaLevel = -1; });
}

export function createTrayPopover(options: TrayPopoverOptions): void {
  if (tray) return;
  currentOptions = options;
  tray = new Tray(loadTrayIcon());
  tray.setToolTip('Quotern');
  trayMenu = buildTrayMenu(options);

  if (isMac || process.platform === 'win32') {
    tray.on('click', () => { options.onOpen?.(); togglePopover(); });
    tray.on('right-click', () => {
      trayMenu = buildTrayMenu(options);
      tray?.popUpContextMenu(trayMenu);
    });
    ipcMain.removeAllListeners(TRAY_POPOVER_RESIZE_CHANNEL);
    ipcMain.on(TRAY_POPOVER_RESIZE_CHANNEL, handlePopoverResize);
  } else {
    tray.setContextMenu(trayMenu);
    tray.on('click', () => options.showMainWindow());
  }
  if (lastQuotaState) setTrayQuotaState(lastQuotaState);
}

/** Rebuild native menu and tooltip when the Desktop language changes. */
export function refreshTrayLocale(): void {
  if (!tray || tray.isDestroyed() || !currentOptions) return;
  trayMenu = buildTrayMenu(currentOptions);
  if (!isMac && process.platform !== 'win32') tray.setContextMenu(trayMenu);
  if (lastQuotaState) setTrayQuotaState(lastQuotaState);
}

export function disposeTrayPopover(): void {
  iconGeneration++; quotaLevel = -1;
  markTrayPopoverQuitting();
  ipcMain.removeAllListeners(TRAY_POPOVER_RESIZE_CHANNEL);
  if (popover && !popover.isDestroyed()) {
    popover.removeAllListeners('blur');
    popover.removeAllListeners('close');
    popover.destroy();
  }
  popover = null;

  if (tray && !tray.isDestroyed()) {
    tray.removeAllListeners('click');
    tray.removeAllListeners('right-click');
    tray.destroy();
  }
  tray = null;
  trayMenu = null;
  currentOptions = null;
  lastQuotaState = null;
}
