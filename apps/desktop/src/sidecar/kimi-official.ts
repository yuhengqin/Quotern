const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const unavailable = (status: 'not-signed-in' | 'expired' | 'temporarily-unavailable', message: string) =>
  ({ status, message, limits: [], planLabel: null, fetchedAt: null, stale: false });

function resetTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

type Limit = { id: string; label: string; usedPercent: number; resetsAt: number | null }
  | { id: string; label: string; currency: 'USD' | 'CNY'; remaining: number; resetsAt: null };

export async function readKimiOfficial(token?: string, request: typeof fetch = fetch) {
  if (!token?.trim()) return unavailable('not-signed-in', '请先授权 Kimi 本地服务');
  try {
    const response = await request('http://127.0.0.1:58627/api/v1/oauth/usage', {
      method: 'GET', headers: { Authorization: `Bearer ${token.trim()}` }, redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return response.status === 401 || response.status === 403
      ? unavailable('expired', 'Kimi 本地服务授权已失效')
      : unavailable('temporarily-unavailable', 'Kimi 用量查询失败');
    const root = record(await response.json()), data = record(root?.data);
    if (root?.code !== 0) throw new Error('Invalid envelope');
    if (data?.kind === 'error' && (data.status === 401 || data.status === 403)) return unavailable('expired', 'Kimi 授权已失效');
    const quota = record(data?.quota), usages = record(quota?.usages);
    if (data?.kind !== 'ok' || !quota || !usages) throw new Error('Invalid quota');
    const limits: Limit[] = [];
    for (const [id, label] of [['limit5h', '5h'], ['limit7d', '7d'], ['monthTotal', '月度共享额度'], ['monthCode', '月度代码额度']] as const) {
      const value = usages[id];
      if (value === undefined || value === null) continue;
      const row = record(value), ratio = row?.usedRatio;
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error('Invalid usage');
      limits.push({ id, label, usedPercent: ratio * 100, resetsAt: resetTimestamp(row?.resetAt) });
    }
    if (quota.extraUsage !== undefined && quota.extraUsage !== null) {
      const wallet = record(quota.extraUsage), cents = wallet?.balanceCents, currency = wallet?.currency;
      if ((currency !== 'USD' && currency !== 'CNY') || typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) throw new Error('Invalid wallet');
      limits.push({ id: `balance-${currency.toLowerCase()}`, label: `${currency} 余额`, currency, remaining: cents / 100, resetsAt: null });
    }
    if (!limits.length) throw new Error('Empty quota');
    return { status: 'ready', message: null, limits, planLabel: null, fetchedAt: Math.floor(Date.now() / 1000), stale: false };
  } catch {
    return unavailable('temporarily-unavailable', 'Kimi 用量查询失败');
  }
}
