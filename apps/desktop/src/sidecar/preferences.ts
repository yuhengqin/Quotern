import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isLocalePreference, resolveLocale } from 'quotern-i18n';
import { DEFAULT_DASHBOARD_RANGE, isDashboardRange } from '../shared/dashboard-range';
import { isThemeMode } from '../shared/theme';
import { isTrayUsageMode } from '../shared/tray-usage';
import { createAppearanceController } from '../main/appearance-controller';
import { readAppearancePreferences, writeAppearancePreferences } from '../main/appearance-store';
import { appearanceChrome, DEFAULT_APPEARANCE } from '../shared/appearance';

export async function desktopPreferences(profile: string, emit: (channel: string, ...args: unknown[]) => void) {
  const file = join(profile, 'desktop-prefs.json');
  await mkdir(profile, { recursive: true });
  let values: Record<string, unknown>;
  try {
    values = JSON.parse(await readFile(file, 'utf8'));
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid desktop preferences');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    values = {};
  }
  let writing = Promise.resolve();
  const set = (key: string, value: unknown) => {
    const operation = writing.then(async () => {
      const next = { ...values, [key]: value };
      const temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(next, null, 2), {mode:0o600});
      await rename(temporary, file);
      values = next;
    });
    writing = operation.catch(() => {});
    return operation;
  };
  const systemLocale = resolveLocale('system', [Intl.DateTimeFormat().resolvedOptions().locale]);
  const locale = () => {
    const preference = isLocalePreference(values.localePreference) ? values.localePreference : 'system';
    return { preference, systemLocale, resolved: preference === 'system' ? systemLocale : preference };
  };
  let dark = false;
  const theme = () => {
    const mode = isThemeMode(values.themeMode) ? values.themeMode : 'system';
    return { mode, resolved: mode === 'system' ? (dark ? 'dark' : 'light') : mode };
  };
  const appearance = createAppearanceController({
    read: () => readAppearancePreferences(profile),
    write: value => writeAppearancePreferences(profile, value),
    apply() {}, publish: value => emit('appearance:changed', value),
  });
  return {
    async chrome() {
      const { mode, resolved }=theme();
      const appearanceValue=await appearance.get() ?? DEFAULT_APPEARANCE;
      return {mode,...appearanceChrome(resolved==='dark'?'dark':'light',appearanceValue.style)};
    },
    channels: new Map<string, (...args: unknown[]) => unknown>([
      ['appearance:get', appearance.get], ['appearance:set', appearance.set], ['appearance:initialize', appearance.initialize],
      ['theme:get', theme],
      ['theme:set', async mode => { if (!isThemeMode(mode)) throw Error('Invalid theme'); await set('themeMode', mode); emit('theme:changed', theme()); }],
      ['locale:get', locale],
      ['locale:set', async next => { if (!isLocalePreference(next)) throw Error('Invalid locale'); await set('localePreference', next); emit('locale:changed', locale()); return locale(); }],
      ['dashboard-range:get', () => isDashboardRange(values.dashboardRange) ? values.dashboardRange : DEFAULT_DASHBOARD_RANGE],
      ['dashboard-range:set', async range => { if (!isDashboardRange(range)) throw Error('Invalid dashboard range'); await set('dashboardRange', range); emit('dashboard-range:changed', range); return range; }],
      ['tray-usage:get', () => values.showTrayUsage !== false],
      ['tray-usage:set', async value => { if (typeof value !== 'boolean') throw Error('Invalid tray setting'); await set('showTrayUsage', value); emit('tray-usage:changed', value); return value; }],
      ['tray-usage-mode:get', () => isTrayUsageMode(values.trayUsageMode) ? values.trayUsageMode : 'both'],
      ['tray-usage-mode:set', async value => { if (!isTrayUsageMode(value)) throw Error('Invalid tray setting'); await set('trayUsageMode', value); emit('tray-usage-mode:changed', value); return value; }],
      ['autostart:get', () => values.openAtLogin !== false],
      ['autostart:save', async value => { if (typeof value !== 'boolean') throw Error('Invalid login preference'); await set('openAtLogin', value); emit('autostart:changed', value); return value; }],
      ['autostart:get-hidden', () => values.launchHidden !== false],
      ['autostart:set-hidden', async value => { if (typeof value !== 'boolean') throw Error('Invalid login preference'); await set('launchHidden', value); emit('autostart:changed', values.openAtLogin !== false); return value; }],
    ]),
    set, locale:()=>locale().resolved, systemTheme(value: boolean) { if (dark !== value) { dark = value; emit('theme:changed', theme()); } },
    flush: () => writing,
  };
}
