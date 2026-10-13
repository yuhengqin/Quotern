/** Read-only subset of the local DeepSeek account balance snapshot. */
export type DeepSeekSubscriptionStatus =
  | 'ready'
  | 'custom-provider'
  | 'not-installed'
  | 'not-signed-in'
  | 'expired'
  | 'temporarily-unavailable';

export interface DeepSeekBalanceWindow {
  id: 'balance-cny';
  label: string;
  /** Percentage used to drive the tray ring (used / total * 100, clamped). */
  usedPercent: number;
  /** Free-form description shown beneath the ring, e.g. "余额 ¥X.XX / ¥Y.YY". */
  description: string | null;
  /** Remaining CNY amount, formatted to two decimals; null when unknown. */
  remaining: number | null;
  /** Total CNY amount; null when unknown. */
  total: number | null;
  /** Unix timestamp in seconds (DeepSeek currently returns no expiry, so always null). */
  resetsAt: number | null;
}

export interface DeepSeekSubscriptionSnapshot {
  status: DeepSeekSubscriptionStatus;
  planLabel: string | null;
  limits: DeepSeekBalanceWindow[];
  /** Unix timestamp in seconds. */
  fetchedAt: number | null;
  stale: boolean;
  message: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedPercent(used: number | null, total: number | null): number {
  if (used === null || total === null || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 10000) / 100));
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return '—';
  return `¥${amount.toFixed(2)}`;
}

/** Normalize DeepSeek's `GET /user/balance` response into a single CNY balance window. */
export function mapDeepSeekBalance(value: unknown): Pick<
  DeepSeekSubscriptionSnapshot,
  'planLabel' | 'limits'
> {
  const root = asRecord(value);
  if (!root) return { planLabel: null, limits: [] };

  // DeepSeek returns either `balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }]`
  // or a single `balance` shape. Both forms are accepted and CNY is preferred.
  const balances = Array.isArray(root.balance_infos)
    ? root.balance_infos
    : Array.isArray(root.balanceInfos)
      ? root.balanceInfos
      : root.balance
        ? [root.balance]
        : [];

  if (balances.length === 0
    && finiteNumber(root.total_balance) === null
    && finiteNumber(root.granted_balance) === null
    && finiteNumber(root.topped_up_balance) === null) {
    return { planLabel: null, limits: [] };
  }

  const cnyRecord = balances
    .map(asRecord)
    .find((record) => record && String(record.currency ?? 'CNY').toUpperCase() === 'CNY');

  const totalBalance = finiteNumber(cnyRecord?.total_balance ?? cnyRecord?.totalBalance ?? root.total_balance);
  const grantedBalance = finiteNumber(
    cnyRecord?.granted_balance ?? cnyRecord?.grantedBalance ?? root.granted_balance,
  );
  const toppedUpBalance = finiteNumber(
    cnyRecord?.topped_up_balance ?? cnyRecord?.toppedUpBalance ?? root.topped_up_balance,
  );

  const remaining = [grantedBalance, toppedUpBalance].some((value) => value !== null)
    ? Math.max(0, (grantedBalance ?? 0) + (toppedUpBalance ?? 0))
    : totalBalance;

  const total = totalBalance ?? remaining;
  const description = total !== null && remaining !== null
    ? `余额 ${formatCurrency(remaining)} / ${formatCurrency(total)}`
    : null;

  const window: DeepSeekBalanceWindow = {
    id: 'balance-cny',
    label: 'CNY 余额',
    usedPercent: boundedPercent(
      total !== null && remaining !== null ? total - remaining : null,
      total,
    ),
    description,
    remaining,
    total,
    resetsAt: null,
  };

  return { planLabel: null, limits: [window] };
}

export function deepSeekRemainingPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.min(100, Math.max(0, 100 - usedPercent));
}
