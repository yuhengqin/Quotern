import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { QuotaProviderId } from 'quotern-core/quota/shared/provider-descriptors';
import { mapOpenCodeUsage } from 'quotern-core/quota/shared/opencode-subscription';
import { quotaNodeFetch, recordQuotaAttempt } from 'quotern-core/quota/readers/quota-fetch-state';
import { markQuotaIdentity } from 'quotern-core/quota/readers/quota-identity';
import { homedir, tmpdir } from 'node:os';

type Provider = { method: 'api-key' | 'official-cli' | 'official-page'; url: string; destination: 'guide' | 'usage' };
export const officialProviders = {
  codex: {method:'official-cli',url:'https://chatgpt.com/codex/settings/usage',destination:'usage'},
  claude: {method:'official-cli',url:'https://claude.ai/settings/usage',destination:'usage'},
  gemini: {method:'official-page',url:'https://geminicli.com/docs/reference/commands/#stats',destination:'guide'},
  muse: {method:'official-cli',url:'https://dev.meta.ai/docs/muse-code/changelog',destination:'guide'},
  cursor: {method:'official-page',url:'https://cursor.com/dashboard/spending',destination:'usage'},
  copilot: {method:'official-cli',url:'https://github.com/settings/billing',destination:'usage'},
  grok: {method:'official-page',url:'https://grok.com/?_s=usage',destination:'usage'},
  kimi: {method:'api-key',url:'https://www.kimi.com/code/console',destination:'usage'},
  zcode: {method:'official-page',url:'https://z.ai/manage-apikey/coding-plan/personal/my-plan',destination:'usage'},
  antigravity: {method:'official-page',url:'https://antigravity.google/docs/cli/commands/usage',destination:'guide'},
  qoder: {method:'official-page',url:'https://qoder.com/account/usage',destination:'usage'},
  minimax: {method:'official-cli',url:'https://github.com/MiniMax-AI/cli#mmx-config--mmx-quota',destination:'guide'},
  opencode: {method:'api-key',url:'https://opencode.ai/console',destination:'usage'},
  deepseek: {method:'api-key',url:'https://api-docs.deepseek.com/api/get-user-balance/',destination:'guide'},
} as const satisfies Record<QuotaProviderId, Provider>;

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unavailable = (status: string, message: string) => ({ status, message, limits: [], planLabel: null, fetchedAt: null, stale: false });
const number = (value: unknown): number | null => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;

async function readOpenCodeGo(secret?: string) {
  const token = secret?.trim();
  if (!token) return unavailable('not-signed-in', '请连接 OpenCode Go');
  const failed = () => markQuotaIdentity(unavailable('temporarily-unavailable', '暂时无法读取 OpenCode Go 额度'), token);
  let response: Response;
  try {
    response = await quotaNodeFetch('https://opencode.ai/inference/go/v1/usage', {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
  } catch { return failed(); }
  if (response.status === 401) return unavailable('expired', 'OpenCode Go 密钥已失效，请重新连接');
  if (response.status === 403) return unavailable('access-denied', '此密钥无法查询 OpenCode Go 订阅额度');
  if (!response.ok) return failed();

  try {
    const usage = record(record(await response.json())?.usage);
    const meters = Object.fromEntries(Object.entries(usage ?? {}).filter(([, value]) => {
      const meter = record(value);
      const percent = meter?.percent;
      return (meter?.status === 'ok' || meter?.status === 'rate-limited')
        && typeof percent === 'number' && Number.isInteger(percent) && percent >= 0 && percent <= 100;
    }));
    const { limits } = mapOpenCodeUsage({ usage: meters });
    if (limits.length) return markQuotaIdentity({
      status: 'ready', limits, planLabel: null, fetchedAt: Math.floor(Date.now() / 1000), stale: false, message: null,
    }, token);
  } catch { /* An unreadable response has no usable quota. */ }
  recordQuotaAttempt({ stage: 'parse', outcome: 'failure', code: 'INVALID_RESPONSE' });
  return failed();
}

async function readDeepSeek(secret?: string): Promise<unknown> {
  if (!secret?.trim()) return unavailable('not-signed-in', '请先授权 DeepSeek API key');
  try {
    const response = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return unavailable(response.status === 401 || response.status === 403 ? 'expired' : 'temporarily-unavailable', 'DeepSeek 余额查询失败');
    const root = record(await response.json());
    if (typeof root?.is_available !== 'boolean' || !Array.isArray(root.balance_infos) || !root.balance_infos.length) throw new Error('Invalid response');
    const seen = new Set<string>();
    const limits = root.balance_infos.map((value: unknown) => {
      const row = record(value), currency = row?.currency;
      const remaining = number(row?.total_balance), granted = number(row?.granted_balance), toppedUp = number(row?.topped_up_balance);
      if ((currency !== 'CNY' && currency !== 'USD') || seen.has(currency) || remaining === null || granted === null || toppedUp === null) throw new Error('Invalid balance');
      seen.add(currency);
      return { id: `balance-${currency.toLowerCase()}`, label: `${currency} 余额`, currency, remaining, usedPercent: 0, resetsAt: null };
    });
    return { status: 'ready', planLabel: null, limits, fetchedAt: Math.floor(Date.now() / 1000), stale: false, message: null };
  } catch { return unavailable('temporarily-unavailable', 'DeepSeek 余额查询失败'); }
}

export function mapMiniMaxOfficialQuota(value: unknown) {
  const root = record(value);
  if (root && 'available_amount' in root) return unavailable('unsupported-account', '暂不支持 MiniMax 按量余额，请查看官方页面');
  const base = record(root?.base_resp);
  if (!root || !Array.isArray(root.model_remains) || (base && base.status_code !== 0)) return unavailable('temporarily-unavailable', 'MiniMax 配额响应无效');
  const limits: Array<{id:string; label:string; remainingPercent:number; resetsAt:null}> = [];
  const ids = new Set<string>();
  for (const item of root.model_remains) {
    const row = record(item);
    if (typeof row?.model_name !== 'string' || !row.model_name.trim()) continue;
    const model = row.model_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!model) continue;
    for (const [suffix, key] of [['interval', 'current_interval_remaining_percent'], ['weekly', 'current_weekly_remaining_percent']] as const) {
      const percent = row[key], id = `${model}-${suffix}`;
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 || ids.has(id)) continue;
      ids.add(id); limits.push({id, label:row.model_name, remainingPercent:percent, resetsAt:null});
    }
  }
  if (!limits.length) return unavailable('temporarily-unavailable', 'MiniMax 未返回可用配额');
  return { status:'ready', message:null, limits, planLabel:null, fetchedAt:Math.floor(Date.now() / 1000), stale:false };
}

async function readMiniMax(): Promise<unknown> {
  try {
    const [{ guiCliEnvironment }, { runClaudeCommand }, { findSessionExecutable }] = await Promise.all([
      import('quotern-core/quota/readers/cli-runtime'), import('quotern-core/quota/readers/claude-subscription'), import('quotern-core/session-actions'),
    ]);
    const env = guiCliEnvironment();
    delete env.MINIMAX_BASE_URL;
    delete env.MINIMAX_VERBOSE;
    const shim = join(env.APPDATA ?? '', 'npm', 'mmx.cmd');
    const command = process.platform === 'win32' && existsSync(shim) ? shim : await findSessionExecutable('mmx', tmpdir(), env);
    if (!command) return unavailable('not-installed', '未检测到本机 MiniMax CLI');
    const result = await runClaudeCommand(command, ['quota', 'show', '--output', 'json', '--non-interactive'], homedir(), env, 10_000);
    if (result.code !== 0) return unavailable('temporarily-unavailable', 'MiniMax CLI 查询失败');
    return mapMiniMaxOfficialQuota(JSON.parse(result.stdout));
  } catch { return unavailable('temporarily-unavailable', 'MiniMax CLI 查询失败'); }
}

export async function readOfficialProvider(provider: QuotaProviderId, secret?: string, directory?:string): Promise<unknown> {
  if (provider === 'codex') return (await import('./codex-official.js')).readCodexOfficial(directory);
  if (provider === 'deepseek') return readDeepSeek(secret);
  if (provider === 'opencode') return readOpenCodeGo(secret);
  if (provider === 'kimi') return (await import('./kimi-official.js')).readKimiOfficial(secret);
  if (provider === 'copilot') return (await import('./copilot-official.js')).readCopilotOfficial();
  if (provider === 'claude') {
    const cli = await import('quotern-core/quota/readers/claude-subscription');
    return directory ? cli.createDefaultClaudeSubscriptionReader(directory)() : cli.readClaudeSubscription();
  }
  if (provider === 'muse') {
    const result = await (await import('quotern-core/quota/readers/muse-subscription')).createDefaultMuseSubscriptionReader()();
    return result.status === 'ok' ? { ...result, status: 'ready' } : result;
  }
  if (provider === 'minimax') return readMiniMax();
  return unavailable('unsupported-account', '请查看官方用量页面');
}
