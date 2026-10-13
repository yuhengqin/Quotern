/**
 * Build-time mock / sample-data gate.
 *
 * Only `VITE_ENABLE_MOCK_DATA=true` enables leaderboard mocks and dashboard
 * sample fallback. CLI / production dashboard builds leave it unset (off).
 */
export function isMockDataEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_MOCK_DATA === 'true';
}
