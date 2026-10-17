import type { QuotaProviderState } from '../shared/quota';
import type { SupportedLocale } from 'quotern-i18n';
import { localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import { nativeText } from './native-messages';

export function quotaTraySummary(providers: QuotaProviderState[], locale: SupportedLocale = 'zh-CN'): { level: 0 | 1 | 2; text: string } {
  const windows = providers.filter(provider => provider.status === 'ready' && !provider.stale)
    .flatMap(provider => provider.windows.filter(window => window.analysisEligible !== false).map(window => ({ provider, window })))
    .sort((a, b) => b.window.usedPercent - a.window.usedPercent);
  const tightest = windows[0];
  if (!tightest) return { level: 0, text: nativeText(locale, 'native.tray.noQuota') };
  return { level: tightest.window.usedPercent >= 90 ? 2 : tightest.window.usedPercent >= 70 ? 1 : 0,
    text: nativeText(locale, 'native.tray.remaining', {
      window: `${tightest.provider.label} ${localizeQuotaWindowLabel(locale, tightest.provider.providerId ?? tightest.provider.id, tightest.window)}`,
      percent: Math.round(100 - tightest.window.usedPercent),
    }) };
}
interface Rect { x: number; y: number; width: number; height: number }
export function quotaPopoverBounds(icon: Rect, work: Rect, width: number, height: number): Rect {
  const w = Math.min(width, Math.max(1, work.width - 12)), h = Math.min(height, Math.max(1, work.height - 12));
  const missing = !icon.width && !icon.height;
  const x = missing ? work.x + work.width - w - 6 : icon.x + icon.width / 2 - w / 2;
  const y = missing ? work.y + work.height - h - 6 : icon.y < work.y + work.height / 2 ? icon.y + icon.height + 6 : icon.y - h - 6;
  return { x: Math.round(Math.max(work.x + 6, Math.min(x, work.x + work.width - w - 6))), y: Math.round(Math.max(work.y + 6, Math.min(y, work.y + work.height - h - 6))), width: Math.round(w), height: Math.round(h) };
}
