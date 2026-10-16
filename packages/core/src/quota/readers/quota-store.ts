import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaPreferences, type QuotaProfile, type QuotaSample } from '../shared/quota.js';
import { isSubscriptionChannelVisibility } from '../shared/subscription-channels.js';

export type QuotaHistory = Record<string, QuotaSample[]>;
export function pruneQuotaHistory(history: QuotaHistory, now: number): boolean {
  let changed = false;
  for (const [key, rows] of Object.entries(history)) {
    const keep = rows.filter(sample => sample.at >= now - 90 * 86400 && sample.at <= now + 60).slice(-50000);
    if (keep.length !== rows.length) { changed = true; history[key] = keep; }
    if (!keep.length) { delete history[key]; changed = true; }
  }
  return changed;
}
export interface QuotaStore {
  preferences: QuotaPreferences;
  history: QuotaHistory;
  notice: string | null;
  savePreferences(value: QuotaPreferences): Promise<void>;
  saveHistory(value: QuotaHistory): Promise<void>;
}
export function validQuotaProfiles(value: unknown): value is QuotaProfile[] {
  if (!Array.isArray(value) || value.length > 20) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !['id', 'provider', 'label', 'directory', 'enabled', 'alerts'].includes(key))) return false;
    if (typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(row.id) || ids.has(row.id)) return false;
    if (!['codex', 'claude'].includes(row.provider as string) || typeof row.enabled !== 'boolean') return false;
    if (row.alerts !== undefined && typeof row.alerts !== 'boolean') return false;
    if (typeof row.label !== 'string' || !row.label.trim() || row.label.length > 60 || /[\r\n\x00]/.test(row.label)) return false;
    if (typeof row.directory !== 'string' || row.directory.length > 2048 || /[\r\n\x00"]/.test(row.directory) || !path.isAbsolute(row.directory)) return false;
    ids.add(row.id); return true;
  });
}
export function validQuotaPatch(value: unknown): value is Partial<QuotaPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return Object.entries(raw).every(([key, value]) => ['thresholdAlerts', 'resetAlerts', 'showSparkline'].includes(key) ? typeof value === 'boolean'
    : key === 'paceModel' ? ['uniform', 'workdays', 'automatic'].includes(value as string)
    : key === 'channels' ? isSubscriptionChannelVisibility(value)
      : key === 'profiles' ? validQuotaProfiles(value) : false);
}
export async function openQuotaStore(directory: string): Promise<QuotaStore> {
  let preferences = structuredClone(DEFAULT_QUOTA_PREFERENCES), history: QuotaHistory = {};
  let notice: string | null = null, preferencesReadable = true;
  try {
    const decoded: unknown = JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8'));
    if (!validQuotaPatch(decoded)) throw new Error('invalid preferences');
    preferences = { ...preferences, ...decoded, channels: { ...preferences.channels, ...decoded.channels } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      preferencesReadable = false;
      preferences.thresholdAlerts = false; preferences.resetAlerts = false;
      notice = '无法读取额度设置，已暂停提醒。请检查额度设置文件及访问权限。';
    }
  }
  try {
    const decoded: unknown = JSON.parse(await readFile(path.join(directory, 'history.json'), 'utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('invalid history');
    for (const [key, rows] of Object.entries(decoded).slice(0, 512)) {
      if (key.length > 512 || !Array.isArray(rows)) continue;
      history[key] = rows.filter((sample): sample is QuotaSample => sample && typeof sample === 'object'
        && typeof sample.at === 'number' && Number.isFinite(sample.at) && typeof sample.usedPercent === 'number'
        && Number.isFinite(sample.usedPercent) && sample.usedPercent >= 0 && sample.usedPercent <= 100
        && (sample.resetsAt === null || typeof sample.resetsAt === 'number' && Number.isFinite(sample.resetsAt)))
        .sort((a, b) => a.at - b.at).slice(-50000);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') notice ??= '额度历史暂不可用，分析将从新的有效读数开始。';
  }
  let queue = Promise.resolve();
  const save = (file: string, value: unknown) => {
    const serialized = JSON.stringify(value);
    const pending = queue.then(async () => {
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `${file}.${process.pid}.tmp`);
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, path.join(directory, file));
    });
    queue = pending.catch(() => {});
    return pending;
  };
  const store: QuotaStore = { preferences, history, notice,
    async savePreferences(value) {
      if (!preferencesReadable) throw new Error('无法保存额度设置，请先修复文件或访问权限');
      await save('preferences.json', value);
    },
    saveHistory: value => save('history.json', value),
  };
  if (pruneQuotaHistory(history, Date.now() / 1000)) {
    try { await store.saveHistory(history); }
    catch { store.notice ??= '过期额度历史暂未能清理，请检查目录权限。'; }
  }
  return store;
}
