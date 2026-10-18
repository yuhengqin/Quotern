import { platform } from 'node:os';

import {
  DEFAULT_DATA_DIR,
  DEFAULT_PORT,
  getRunningOwner,
  loadConfig,
  saveConfig,
  touchStatsSince,
  isIsolatedDevRuntime,
} from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';

import {
  clearPid,
  daemonLogPath,
  readDaemonLogTail,
  stopPid,
  waitForServiceReady,
} from './daemon.js';
import { DEFAULT_HOST, formatListenUrl } from './args.js';
import {
  isLinuxAutostartRegistered,
  registerLinuxAutostart,
  unregisterLinuxAutostart,
} from './service-linux.js';
import {
  isMacosAutostartRegistered,
  registerMacosAutostart,
  unregisterMacosAutostart,
} from './service-macos.js';
import {
  isWindowsAutostartRegistered,
  registerWindowsAutostart,
  unregisterWindowsAutostart,
} from './service-windows.js';
import { cliT, systemCliLocale, userError } from './i18n/locale.js';

type ServicePlatform = 'darwin' | 'win32' | 'linux';

function assertSupportedPlatform(locale: SupportedLocale): ServicePlatform {
  if (isIsolatedDevRuntime()) {
    throw userError(locale, 'service.isolated');
  }
  const p = platform();
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  throw userError(locale, 'service.platform', { platform: p });
}

async function isAutostartRegistered(locale: SupportedLocale): Promise<boolean> {
  const p = assertSupportedPlatform(locale);
  if (p === 'darwin') return isMacosAutostartRegistered();
  if (p === 'win32') return isWindowsAutostartRegistered();
  return isLinuxAutostartRegistered();
}

async function registerAutostart(cliBinPath: string, dataDir: string, locale: SupportedLocale): Promise<void> {
  const p = assertSupportedPlatform(locale);
  if (p === 'darwin') {
    await registerMacosAutostart(cliBinPath, dataDir);
    return;
  }
  if (p === 'win32') {
    await registerWindowsAutostart(cliBinPath, dataDir);
    return;
  }
  await registerLinuxAutostart(cliBinPath, dataDir);
}

async function unregisterAutostart(locale: SupportedLocale): Promise<void> {
  const p = assertSupportedPlatform(locale);
  if (p === 'darwin') {
    await unregisterMacosAutostart();
    return;
  }
  if (p === 'win32') {
    await unregisterWindowsAutostart();
    return;
  }
  await unregisterLinuxAutostart();
}

/**
 * Re-register autostart while the service is already running.
 * On failure warn and continue (the running service is unaffected), so a
 * non-elevated Windows terminal does not abort `service start`.
 */
async function registerAutostartOrWarn(cliBinPath: string, dataDir: string, locale: SupportedLocale): Promise<boolean> {
  try {
    await registerAutostart(cliBinPath, dataDir, locale);
    return true;
  } catch (err) {
    console.warn(`  ${cliT(locale, 'service.autostartFailed')}`);
    console.warn(`  ${cliT(locale, 'service.autostartHint')}`);
    if (process.env.QUOTERN_DEBUG === '1') console.warn(cliT(locale, 'common.debugDetails', { details: err instanceof Error ? err.message : String(err) }));
    return false;
  }
}

export async function cmdServiceStart(
  cliBinPath: string,
  daysAgo?: number,
  listen?: { port?: number; host?: string },
  locale: SupportedLocale = systemCliLocale(),
): Promise<void> {
  assertSupportedPlatform(locale);
  const startedAt = Date.now();
  const waitTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  ${cliT(locale, 'service.waiting', { seconds: new Intl.NumberFormat(locale).format(elapsed) })}`);
  }, 3_000);

  try {
    await cmdServiceStartBody(cliBinPath, daysAgo, listen, locale);
  } finally {
    clearInterval(waitTimer);
  }
}

async function cmdServiceStartBody(
  cliBinPath: string,
  daysAgo: number | undefined,
  listen: { port?: number; host?: string } | undefined,
  locale: SupportedLocale,
): Promise<void> {
  const { dir, config } = await loadConfig();
  // Seed statsSince before launchd starts `quotern start` (do not bake --days into plist).
  await touchStatsSince(dir, config, daysAgo != null ? { daysAgo } : undefined);
  if (listen?.port != null) config.serverPort = listen.port;
  if (listen?.host != null) config.serverHost = listen.host;
  if (listen?.port != null || listen?.host != null) {
    await saveConfig(dir, config);
  }
  const existing = await getRunningOwner(dir);

  if (existing != null) {
    // Already running: still ensure autostart is registered.
    const who = cliT(locale, `common.kind.${existing.kind}`);
    const registered = await isAutostartRegistered(locale);
    if (!registered) {
      const autostartRegistered = await registerAutostartOrWarn(cliBinPath, dir, locale);
      console.log(
        autostartRegistered
          ? cliT(locale, 'service.alreadyRegistered', { kind: who, pid: existing.pid })
          : cliT(locale, 'service.alreadyUnregistered', { kind: who, pid: existing.pid }),
      );
    } else {
      console.log(cliT(locale, 'service.already', { kind: who, pid: existing.pid }));
    }
    if (existing.kind === 'desktop') {
      console.log(`  ${cliT(locale, 'service.desktopOwner')}`);
      console.log(`  ${cliT(locale, 'service.observerHint')}`);
    }
    console.log(`  ${cliT(locale, 'start.panel', { url: formatListenUrl(config.serverHost || DEFAULT_HOST, config.serverPort || DEFAULT_PORT) })}`);
    return;
  }

  await registerAutostart(cliBinPath, dir, locale);
  const port = config.serverPort || DEFAULT_PORT;
  const host = config.serverHost || DEFAULT_HOST;
  const ready = await waitForServiceReady(dir, port, host);
  if (ready.pid == null && !ready.health) {
    const logPath = daemonLogPath(dir);
    if (process.env.QUOTERN_DEBUG === '1') {
      const tail = await readDaemonLogTail(dir);
      if (tail) console.error(cliT(locale, 'common.debugDetails', { details: tail }));
    }
    throw userError(locale, 'service.startTimeout', { path: logPath });
  }

  const { config: refreshed } = await loadConfig(dir);
  const panelPort = refreshed.serverPort || DEFAULT_PORT;
  const panelHost = refreshed.serverHost || DEFAULT_HOST;
  if (ready.pid != null) {
    console.log(cliT(locale, 'service.startedPid', { pid: ready.pid }));
  } else {
    console.log(cliT(locale, 'service.startedHealth'));
  }
  console.log(`  ${cliT(locale, 'start.panel', { url: formatListenUrl(panelHost, panelPort) })}`);
  console.log(`  ${cliT(locale, 'start.data', { dir })}`);
  console.log(`  ${cliT(locale, 'service.autostart', { state: cliT(locale, 'service.registered') })}`);
  console.log(`  ${cliT(locale, 'service.log', { path: daemonLogPath(dir) })}`);
}

export async function cmdServiceStop(locale: SupportedLocale = systemCliLocale()): Promise<void> {
  assertSupportedPlatform(locale);
  const { dir } = await loadConfig();

  // Unregister first so KeepAlive / task restart cannot bring the process back.
  await unregisterAutostart(locale);

  const owner = await getRunningOwner(dir);
  if (owner != null) {
    if (owner.kind === 'desktop') {
      // Do not kill the Electron process; only clear CLI autostart above.
      console.log(cliT(locale, 'service.stopDesktop', { pid: owner.pid }));
      return;
    }
    const stopped = await stopPid(owner.pid);
    if (!stopped) {
      throw userError(locale, 'service.stopPidFailed', { pid: owner.pid });
    }
  }
  await clearPid(dir);
  console.log(cliT(locale, 'service.stopped'));
}

export async function cmdServiceStatus(locale: SupportedLocale = systemCliLocale()): Promise<void> {
  assertSupportedPlatform(locale);
  const { dir, config } = await loadConfig();
  const owner = await getRunningOwner(dir);
  const registered = await isAutostartRegistered(locale);
  const port = config.serverPort || DEFAULT_PORT;
  const host = config.serverHost || DEFAULT_HOST;

  if (owner != null) {
    console.log(cliT(locale, 'service.statusOwner', { kind: cliT(locale, `common.kind.${owner.kind}`), pid: owner.pid }));
  } else {
    console.log(cliT(locale, 'service.statusStopped'));
  }
  console.log(cliT(locale, 'service.autostart', { state: cliT(locale, registered ? 'service.registered' : 'service.unregistered') }));
  console.log(cliT(locale, 'start.panel', { url: formatListenUrl(host, port) }));
  console.log(cliT(locale, 'start.data', { dir: dir || DEFAULT_DATA_DIR }));
  console.log(cliT(locale, 'status.lastSync', { date: config.lastSyncAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(config.lastSyncAt)) : cliT(locale, 'common.never') }));
  console.log(cliT(locale, 'service.log', { path: daemonLogPath(dir) }));
}
