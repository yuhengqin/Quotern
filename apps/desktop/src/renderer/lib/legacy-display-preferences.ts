import { isDashboardRange } from '../../shared/dashboard-range';
import { isDashboardDateRange } from './dashboard-date-range';

const migrationKey = 'quotern.desktop.legacy-display-preferences.v1';
const tokenKey = 'quotern-token-unit-mode';
const rangeKey = 'tud.dashboardRange';
const customRangeKey = 'tud.dashboardCustomRange';

function parsePreference(value: string | undefined): unknown {
  if (typeof value !== 'string') return undefined;
  try { return JSON.parse(value); }
  catch { return undefined; }
}

export async function restoreLegacyDisplayPreferences(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  readLegacy: () => Promise<Record<string, string>>,
  readSavedRange: () => Promise<unknown>,
  now = new Date(),
): Promise<void> {
  try {
    if (storage.getItem(migrationKey) === 'done') return;
    const legacy = await readLegacy();
    const token = legacy[tokenKey];
    if (storage.getItem(tokenKey) === null && (token === 'localized' || token === 'international')) {
      storage.setItem(tokenKey, token);
    }
    const customRange = parsePreference(legacy[customRangeKey]);
    if (storage.getItem(rangeKey) === null && storage.getItem(customRangeKey) === null &&
        isDashboardDateRange(customRange, now)) {
      storage.setItem(customRangeKey, JSON.stringify({ start: customRange.start, end: customRange.end }));
    }
    if (storage.getItem(rangeKey) === null) {
      const oldRange = parsePreference(legacy[rangeKey]);
      const range = isDashboardRange(oldRange) ? oldRange : await readSavedRange();
      if (storage.getItem(rangeKey) === null && isDashboardRange(range)) {
        storage.setItem(rangeKey, JSON.stringify(range));
      }
    }
    storage.setItem(migrationKey, 'done');
  } catch {
    // Retry an unavailable old profile on the next launch.
  }
}
