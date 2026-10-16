import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  screen,
} from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import type { QuotaState } from '../shared/quota';
import { quotaPopoverBounds, quotaTraySummary } from './tray-quota';
import { defaultPreloadPath, resolveAppIconPath, WINDOW_BACKGROUND_COLORS, type DesktopWindowTheme } from './DesktopWindow';
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

const POPOVER_WIDTH = 430;
const POPOVER_MIN_HEIGHT = 200;
const POPOVER_MAX_HEIGHT = 700;
/** Initial height; the renderer reports its real content height on first paint. */
const POPOVER_INITIAL_HEIGHT = POPOVER_MIN_HEIGHT;

export interface TrayPopoverOptions {
  showMainWindow: () => void;
  openSettings: () => void;
  /** Same as in-app「同步数据」→ POST tud-trigger-sync. */
  triggerSync: () => void;
  /** Windows desktop pet toggle. */
  togglePet?: () => void;
  onOpen?: () => void;
  /** Initial popover window background, kept in sync with the app theme. */
  theme: DesktopWindowTheme;
}

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let popoverTheme: DesktopWindowTheme = 'light';
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
  return Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => options.showMainWindow(),
    },
    {
      label: '同步数据',
      click: () => options.triggerSync(),
    },
    ...(!isMac && options.togglePet ? [{
      label: '显示/隐藏桌面宠物',
      click: () => options.togglePet?.(),
    }] : []),
    {
      label: '设置',
      click: () => options.openSettings(),
    },
    { type: 'separator' },
    {
      label: '退出',
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
    backgroundColor: WINDOW_BACKGROUND_COLORS[popoverTheme],
    // Keep native resizing enabled for programmatic auto-height updates. The
    // active height is locked with equal min/max bounds after every update.
    resizable: true,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
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

/** Keep the popover's native background in sync with the app theme. */
export function setPopoverTheme(theme: DesktopWindowTheme): void {
  popoverTheme = theme;
  if (popover && !popover.isDestroyed()) {
    popover.setBackgroundColor(WINDOW_BACKGROUND_COLORS[theme]);
  }
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
  if (!tray || tray.isDestroyed()) return;
  const summary = quotaTraySummary(state.providers);
  const incidents = state.providers.filter(provider => provider.service && !provider.service.stale && !['operational', 'unknown'].includes(provider.service.level)).map(provider => `${provider.label} 服务异常`);
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
  popoverTheme = options.theme;

  tray = new Tray(loadTrayIcon());
  tray.setToolTip('Quotern');
  const menu = buildTrayMenu(options);

  if (isMac || process.platform === 'win32') {
    tray.on('click', () => { options.onOpen?.(); togglePopover(); });
    tray.on('right-click', () => tray?.popUpContextMenu(menu));
    ipcMain.removeAllListeners(TRAY_POPOVER_RESIZE_CHANNEL);
    ipcMain.on(TRAY_POPOVER_RESIZE_CHANNEL, handlePopoverResize);
  } else {
    tray.setContextMenu(menu);
    tray.on('click', () => options.showMainWindow());
  }
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
}
