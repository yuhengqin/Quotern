/**
 * Browser-safe helpers for `DailyUsageRow.models` keys.
 * Keep this file free of node: imports — dashboard/desktop import it via
 * `quotern-core/daily-model-key`.
 */

/** Unit separator — same model name under different sources must not merge. */
export const DAILY_MODEL_KEY_SEP = '\u001f';

/** Key used in `DailyUsageRow.models` so Cursor `auto` ≠ Qoder `auto`. */
export function dailyModelKey(source: string, model: string): string {
  return `${source}${DAILY_MODEL_KEY_SEP}${model}`;
}

/** Parse a daily models map key; plain model names stay backward-compatible. */
export function parseDailyModelKey(key: string): {
  source: string | null;
  model: string;
} {
  const i = key.indexOf(DAILY_MODEL_KEY_SEP);
  if (i === -1) return { source: null, model: key };
  return { source: key.slice(0, i), model: key.slice(i + 1) };
}
