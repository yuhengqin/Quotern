/**
 * Desktop open-at-login preference + OS login item registration.
 *
 * Preference lives in Electron userData (not ~/.ai-usage/config.json).
 * setLoginItemSettings only runs when packaged so `electron-vite dev`
 * does not register the Electron binary itself.
 */
import { BrowserWindow, app, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DASHBOARD_RANGE_CHANGED_CHANNEL,
  DASHBOARD_RANGE_GET_CHANNEL,
  DASHBOARD_RANGE_SET_CHANNEL,
  DEFAULT_DASHBOARD_RANGE,
  isDashboardRange,
  type DashboardRange,
} from '../shared/dashboard-range';
import { isThemeMode, type ThemeMode } from '../shared/theme';
import type { LocalePreference } from 'quotern-i18n';
import {
  DEFAULT_TRAY_USAGE_MODE,
  TRAY_USAGE_CHANGED_CHANNEL,
  TRAY_USAGE_GET_CHANNEL,
  TRAY_USAGE_MODE_CHANGED_CHANNEL,
  TRAY_USAGE_MODE_GET_CHANNEL,
  TRAY_USAGE_MODE_SET_CHANNEL,
  TRAY_USAGE_SET_CHANNEL,
  isTrayUsageMode,
  type TrayUsageMode,
} from '../shared/tray-usage';

const AUTOSTART_GET_CHANNEL = 'autostart:get';
const AUTOSTART_SET_CHANNEL = 'autostart:set';
const AUTOSTART_GET_HIDDEN_CHANNEL = 'autostart:get-hidden';
const AUTOSTART_SET_HIDDEN_CHANNEL = 'autostart:set-hidden';

interface DesktopPrefs {
  openAtLogin: boolean;
  /** 开机自启时是否静默启动（仅托盘，不显示主窗口）。默认开启。 */
  launchHidden: boolean;
  /** 主题模式（system / light / dark）。缺省跟随系统。 */
  themeMode?: ThemeMode;
  /** Product language; older preference files follow the OS. */
  localePreference?: LocalePreference;
  /** Last dashboard time range, shared with the tray popover. */
  dashboardRange?: DashboardRange;
  /** macOS 托盘是否显示实时用量胶囊文字。缺省开启 (true)。 */
  showTrayUsage?: boolean;
  /** macOS 菜单栏展示 Token、费用或两者；缺省展示两者。 */
  trayUsageMode?: TrayUsageMode;
}

export interface AutostartPref {
  openAtLogin: boolean;
  isFirstRun: boolean;
  launchHidden: boolean;
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'desktop-prefs.json');
}

async function readPrefsFile(): Promise<DesktopPrefs | null> {
  const path = prefsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    if (typeof parsed.openAtLogin !== 'boolean') return null;
    return {
      openAtLogin: parsed.openAtLogin,
      launchHidden: typeof parsed.launchHidden === 'boolean'
        ? parsed.launchHidden
        : true,
      themeMode: isThemeMode(parsed.themeMode) ? parsed.themeMode : 'system',
      localePreference: parsed.localePreference === 'system' || parsed.localePreference === 'zh-CN'
        || parsed.localePreference === 'en' || parsed.localePreference === 'ja' || parsed.localePreference === 'ko'
        ? parsed.localePreference : 'system',
      dashboardRange: isDashboardRange(parsed.dashboardRange)
        ? parsed.dashboardRange
        : undefined,
      showTrayUsage: typeof parsed.showTrayUsage === 'boolean'
        ? parsed.showTrayUsage
        : true,
      trayUsageMode: isTrayUsageMode(parsed.trayUsageMode)
        ? parsed.trayUsageMode
        : DEFAULT_TRAY_USAGE_MODE,
    };
  } catch {
    return null;
  }
}

async function writePrefs(prefs: DesktopPrefs): Promise<void> {
  await writeFile(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
}

/** Serialize prefs read-modify-write so consecutive updates cannot clobber
 *  each other (theme switches are user-paced, but a quick flip could otherwise
 *  interleave reads against the same file). */
let prefsQueue: Promise<unknown> = Promise.resolve();

function withPrefsLock<T>(task: () => Promise<T>): Promise<T> {
  const run = prefsQueue.then(task, task);
  prefsQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function patchPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs> {
  return withPrefsLock(async () => {
    const existing = await readPrefsFile();
    const next: DesktopPrefs = {
      openAtLogin: patch.openAtLogin ?? existing?.openAtLogin ?? true,
      launchHidden: patch.launchHidden ?? existing?.launchHidden ?? true,
      themeMode: patch.themeMode !== undefined ? patch.themeMode : existing?.themeMode,
      localePreference: patch.localePreference ?? existing?.localePreference ?? 'system',
      dashboardRange: patch.dashboardRange !== undefined
        ? patch.dashboardRange
        : existing?.dashboardRange,
      showTrayUsage: patch.showTrayUsage !== undefined
        ? patch.showTrayUsage
        : existing?.showTrayUsage ?? true,
      trayUsageMode: patch.trayUsageMode ?? existing?.trayUsageMode ?? DEFAULT_TRAY_USAGE_MODE,
    };
    await writePrefs(next);
    return next;
  });
}

function broadcastDashboardRange(range: DashboardRange): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(DASHBOARD_RANGE_CHANGED_CHANNEL, range);
    }
  }
}

/** Persisted theme mode; defaults to following the OS. */
export function loadThemeMode(): Promise<ThemeMode> {
  // Read under the same lock as writes so a concurrent writeFile truncation
  // cannot surface a half-written prefs file.
  return withPrefsLock(async () => {
    const prefs = await readPrefsFile();
    return prefs?.themeMode ?? 'system';
  });
}

export function saveThemeMode(mode: ThemeMode): Promise<void> {
  return patchPrefs({ themeMode: mode }).then(() => undefined);
}

/** Persisted language choice; shares the serialized desktop-prefs writer. */
export function loadLocalePreference(): Promise<LocalePreference> {
  return withPrefsLock(async () => {
    const prefs = await readPrefsFile();
    return prefs?.localePreference ?? 'system';
  });
}

export function saveLocalePreference(preference: LocalePreference): Promise<void> {
  return patchPrefs({ localePreference: preference }).then(() => undefined);
}

function broadcastTrayUsage(enabled: boolean): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(TRAY_USAGE_CHANGED_CHANNEL, enabled);
    }
  }
}

/** Persisted tray usage visibility for macOS status bar. Defaults to true. */
export function loadShowTrayUsage(): Promise<boolean> {
  return withPrefsLock(async () => {
    const prefs = await readPrefsFile();
    return prefs?.showTrayUsage ?? true;
  });
}

/** 读取菜单栏用量展示模式，旧偏好文件默认显示 Token 和费用。 */
export function loadTrayUsageMode(): Promise<TrayUsageMode> {
  return withPrefsLock(async () => {
    const prefs = await readPrefsFile();
    return prefs?.trayUsageMode ?? DEFAULT_TRAY_USAGE_MODE;
  });
}

let trayUsageListener: (() => void) | null = null;

export function onTrayUsagePrefChanged(listener: () => void): void {
  trayUsageListener = listener;
}

export function saveShowTrayUsage(enabled: boolean): Promise<boolean> {
  return patchPrefs({ showTrayUsage: enabled }).then((prefs) => {
    const val = prefs.showTrayUsage ?? true;
    broadcastTrayUsage(val);
    trayUsageListener?.();
    return val;
  });
}

/** 保存展示模式，并通知渲染层和主进程立即刷新菜单栏文字。 */
export function saveTrayUsageMode(mode: TrayUsageMode): Promise<TrayUsageMode> {
  return patchPrefs({ trayUsageMode: mode }).then((prefs) => {
    const value = prefs.trayUsageMode ?? DEFAULT_TRAY_USAGE_MODE;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(TRAY_USAGE_MODE_CHANGED_CHANNEL, value);
      }
    }
    trayUsageListener?.();
    return value;
  });
}

/** Frozen at init: was *this* process started as a silent login launch? */
let silentThisLaunch = false;

function setOsLoginItem(enabled: boolean, launchHidden: boolean): void {
  if (!app.isPackaged) return;
  // Windows: openAsHidden is ignored; --hidden is the real signal.
  // macOS 13+ SMAppService also ignores openAsHidden (wasOpenedAsHidden stays
  // false). Pass --hidden on every platform and still set openAsHidden for
  // older macOS login-item APIs.
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: launchHidden,
    args: launchHidden ? ['--hidden'] : [],
  });
}

export async function loadAutostartPref(): Promise<AutostartPref> {
  const existing = await readPrefsFile();
  if (!existing) {
    return { openAtLogin: true, isFirstRun: true, launchHidden: true };
  }
  return {
    openAtLogin: existing.openAtLogin,
    isFirstRun: false,
    launchHidden: existing.launchHidden,
  };
}

export async function applyAutostart(
  enabled: boolean,
  launchHidden?: boolean,
): Promise<boolean> {
  const existing = await readPrefsFile();
  const hidden = launchHidden ?? existing?.launchHidden ?? true;
  await patchPrefs({
    openAtLogin: enabled,
    launchHidden: hidden,
  });
  setOsLoginItem(enabled, hidden);
  return enabled;
}

/** 读取「开机静默启动」偏好，默认开启。 */
export async function loadLaunchHidden(): Promise<boolean> {
  const existing = await readPrefsFile();
  return existing?.launchHidden ?? true;
}

/** 切换「开机静默启动」偏好并同步到系统登录项。 */
export async function setLaunchHidden(hidden: boolean): Promise<boolean> {
  const existing = await readPrefsFile();
  const openAtLogin = existing?.openAtLogin ?? true;
  await patchPrefs({
    openAtLogin,
    launchHidden: hidden,
  });
  setOsLoginItem(openAtLogin, hidden);
  return hidden;
}

export async function loadDashboardRange(): Promise<DashboardRange> {
  const existing = await readPrefsFile();
  return existing?.dashboardRange ?? DEFAULT_DASHBOARD_RANGE;
}

export async function saveDashboardRange(range: DashboardRange): Promise<DashboardRange> {
  const current = await loadDashboardRange();
  if (current === range) return range;
  await patchPrefs({ dashboardRange: range });
  broadcastDashboardRange(range);
  return range;
}

/** First launch: enable + register. Later: re-apply stored preference. */
export async function initAutostartOnLaunch(): Promise<boolean> {
  const pref = await loadAutostartPref();
  // OS registration may fail; it must not change how this process was launched.
  silentThisLaunch = detectSilentThisLaunch(pref.launchHidden);
  if (pref.isFirstRun) {
    await applyAutostart(true);
    return true;
  }
  setOsLoginItem(pref.openAtLogin, pref.launchHidden);
  return pref.openAtLogin;
}

function detectSilentThisLaunch(launchHidden: boolean): boolean {
  if (!app.isPackaged) return false;
  if (process.argv.includes('--hidden')) return true;
  try {
    if (process.platform !== 'darwin') return false;
    const settings = app.getLoginItemSettings();
    if (settings.wasOpenedAsHidden) return true;
    return Boolean(settings.wasOpenedAtLogin) && launchHidden;
  } catch {
    return false;
  }
}

/** True when *this* process was launched as a tray-only login item. */
export function shouldStartHidden(): boolean {
  return silentThisLaunch;
}

export function registerAutostartIpc(): void {
  ipcMain.removeHandler(AUTOSTART_GET_CHANNEL);
  ipcMain.handle(AUTOSTART_GET_CHANNEL, async () => {
    const pref = await loadAutostartPref();
    return pref.openAtLogin;
  });

  ipcMain.removeHandler(AUTOSTART_SET_CHANNEL);
  ipcMain.handle(AUTOSTART_SET_CHANNEL, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('openAtLogin must be a boolean');
    }
    return applyAutostart(enabled);
  });

  ipcMain.removeHandler(AUTOSTART_GET_HIDDEN_CHANNEL);
  ipcMain.handle(AUTOSTART_GET_HIDDEN_CHANNEL, async () => loadLaunchHidden());

  ipcMain.removeHandler(AUTOSTART_SET_HIDDEN_CHANNEL);
  ipcMain.handle(AUTOSTART_SET_HIDDEN_CHANNEL, async (_event, hidden: unknown) => {
    if (typeof hidden !== 'boolean') {
      throw new Error('launchHidden must be a boolean');
    }
    return setLaunchHidden(hidden);
  });

  ipcMain.removeHandler(DASHBOARD_RANGE_GET_CHANNEL);
  ipcMain.handle(DASHBOARD_RANGE_GET_CHANNEL, () => loadDashboardRange());

  ipcMain.removeHandler(DASHBOARD_RANGE_SET_CHANNEL);
  ipcMain.handle(DASHBOARD_RANGE_SET_CHANNEL, async (_event, range: unknown) => {
    if (!isDashboardRange(range)) throw new Error('unknown dashboard range');
    return saveDashboardRange(range);
  });

  ipcMain.removeHandler(TRAY_USAGE_GET_CHANNEL);
  ipcMain.handle(TRAY_USAGE_GET_CHANNEL, () => loadShowTrayUsage());

  ipcMain.removeHandler(TRAY_USAGE_SET_CHANNEL);
  ipcMain.handle(TRAY_USAGE_SET_CHANNEL, async (_event, show: unknown) => {
    if (typeof show !== 'boolean') {
      throw new Error('showTrayUsage must be a boolean');
    }
    return saveShowTrayUsage(show);
  });

  ipcMain.removeHandler(TRAY_USAGE_MODE_GET_CHANNEL);
  ipcMain.handle(TRAY_USAGE_MODE_GET_CHANNEL, () => loadTrayUsageMode());

  ipcMain.removeHandler(TRAY_USAGE_MODE_SET_CHANNEL);
  ipcMain.handle(TRAY_USAGE_MODE_SET_CHANNEL, (_event, mode: unknown) => {
    if (!isTrayUsageMode(mode)) throw new Error('unknown tray usage mode');
    return saveTrayUsageMode(mode);
  });
}

export function unregisterAutostartIpc(): void {
  ipcMain.removeHandler(AUTOSTART_GET_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_SET_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_GET_HIDDEN_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_SET_HIDDEN_CHANNEL);
  ipcMain.removeHandler(DASHBOARD_RANGE_GET_CHANNEL);
  ipcMain.removeHandler(DASHBOARD_RANGE_SET_CHANNEL);
  ipcMain.removeHandler(TRAY_USAGE_GET_CHANNEL);
  ipcMain.removeHandler(TRAY_USAGE_SET_CHANNEL);
  ipcMain.removeHandler(TRAY_USAGE_MODE_GET_CHANNEL);
  ipcMain.removeHandler(TRAY_USAGE_MODE_SET_CHANNEL);
}
