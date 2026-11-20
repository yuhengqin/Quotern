import { spawn as spawnProcess } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { findSessionExecutable } from 'quotern-core/session-actions';
import { guiCliEnvironment } from 'quotern-core/quota/readers/cli-runtime';
import { codexPlanLabel, mapCodexRateLimitWindows } from 'quotern-core/quota/shared/codex-subscription';
import { codexQuotaWindows } from 'quotern-core/quota/shared/quota-provider-windows';

type Child = EventEmitter & { stdin: Writable; stdout: Readable; stderr: Readable; kill(): boolean };
type Dependencies = { find(): Promise<string | null>; spawn(executable: string): Child; timeoutMs: number };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const failure = (status: 'not-installed' | 'not-signed-in' | 'unavailable', message: string) => ({
  status, message, windows: [], planType: null, planLabel: null, rateLimitResetCredits: null, resetCredits: null, resetCreditExpirations: null,
  fiveHour: null, weekly: null, hasAccount: false, fetchedAt: null, stale: false,
});

async function findCodex(): Promise<string | null> {
  const found = await findSessionExecutable('codex', tmpdir(), guiCliEnvironment());
  if (!found) return null;
  if (process.platform !== 'win32' || extname(found).toLowerCase() === '.exe') return found;
  if (process.arch !== 'x64' && process.arch !== 'arm64') return null;
  const arch = process.arch === 'x64' ? 'x86_64' : 'aarch64';
  const npm = dirname(found), triple = `${arch}-pc-windows-msvc`;
  const roots = [join(npm, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`),
    join(npm, 'node_modules', '@openai', `codex-win32-${process.arch}`), join(npm, 'node_modules', '@openai', 'codex')];
  for (const root of roots) for (const bin of ['bin', 'codex']) {
    const candidate = join(root, 'vendor', triple, bin, 'codex.exe');
    try { if ((await stat(candidate)).isFile()) { await access(candidate, constants.F_OK); return candidate; } } catch { /* Try the next official layout. */ }
  }
  return null;
}

function mapResponse(value: unknown) {
  const result = record(value), fallback = record(result.rateLimits), byId = record(result.rateLimitsByLimitId);
  const main = Object.keys(record(byId.codex)).length ? record(byId.codex) : fallback;
  const convertWindow = (value: unknown) => {
    const row = record(value);
    return { used_percent: row.usedPercent, limit_window_seconds: typeof row.windowDurationMins === 'number' ? row.windowDurationMins * 60 : null, reset_at: row.resetsAt };
  };
  const convertBucket = (value: unknown) => { const row = record(value); return { primary_window: convertWindow(row.primary), secondary_window: convertWindow(row.secondary) }; };
  const additional = Object.entries(byId).filter(([id]) => id !== 'codex').map(([id, value]) => {
    const row = record(value);
    return { metered_feature: id, limit_name: typeof row.limitName === 'string' && row.limitName ? row.limitName : id, rate_limit: convertBucket(row) };
  });
  const windows = codexQuotaWindows({ rate_limit: convertBucket(main), additional_rate_limits: additional });
  if (!windows.length) return failure('unavailable', 'Codex 暂未返回可用额度，请检查登录状态');
  const credits = record(result.rateLimitResetCredits), count = credits.availableCount;
  const resetCredits = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
  const resetCreditExpirations = Array.isArray(credits.credits) ? credits.credits.slice(0, 100).flatMap(value => {
    const row = record(value);
    return row.status === 'available' && typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt) && row.expiresAt > 0 ? [row.expiresAt] : [];
  }).sort((a, b) => a - b) : resetCredits === 0 ? [] : null;
  return { status: 'ready' as const, message: null, windows, planType: main.planType ?? null, rateLimitResetCredits: result.rateLimitResetCredits ?? null,
    planLabel: codexPlanLabel(main.planType), resetCredits, resetCreditExpirations,
    ...mapCodexRateLimitWindows(main), hasAccount: true, fetchedAt: Math.floor(Date.now() / 1000), stale: false };
}

export function createCodexOfficialReader(deps: Dependencies) {
  return async () => {
    let executable: string | null;
    try { executable = await deps.find(); } catch { executable = null; }
    if (!executable) return failure('not-installed', '未找到 Codex 官方 CLI');
    return new Promise<ReturnType<typeof mapResponse>>(resolve => {
      let child: Child;
      try { child = deps.spawn(executable!); } catch { resolve(failure('unavailable', '无法启动 Codex 官方 CLI')); return; }
      let finished = false, phase = 1, bytes = 0, buffer = '';
      const decoder = new StringDecoder('utf8');
      const timer = setTimeout(() => finish(failure('unavailable', 'Codex 官方 CLI 查询超时')), deps.timeoutMs);
      const finish = (result: ReturnType<typeof mapResponse>) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.stdin.destroy();
        try { child.kill(); } catch { /* It already exited. */ }
        resolve(result);
      };
      const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
      child.on('error', () => finish(failure('unavailable', 'Codex 官方 CLI 启动失败')));
      child.on('close', () => finish(failure('unavailable', 'Codex 官方 CLI 已退出')));
      child.stdin.on('error', () => finish(failure('unavailable', 'Codex 官方 CLI 通信失败')));
      child.stdout.on('error', () => finish(failure('unavailable', 'Codex 官方 CLI 通信失败')));
      child.stderr.on('error', () => finish(failure('unavailable', 'Codex 官方 CLI 通信失败')));
      child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) finish(failure('unavailable', 'Codex 官方 CLI 输出过大')); });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { finish(failure('unavailable', 'Codex 官方 CLI 输出过大')); return; }
        buffer += decoder.write(chunk);
        for (;;) {
          const at = buffer.indexOf('\n');
          if (at < 0 || finished) break;
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          let message: Record<string, unknown>;
          try { message = record(JSON.parse(line)); } catch { finish(failure('unavailable', 'Codex 官方 CLI 响应无效')); return; }
          if (message.id !== phase) continue;
          if (message.error) {
            const error = record(message.error);
            const isAuth = typeof error.message === 'string' && /auth|login|sign.?in|unauthorized/i.test(error.message);
            finish(failure(isAuth ? 'not-signed-in' : 'unavailable', isAuth ? '请先登录 Codex 官方 CLI' : 'Codex 官方 CLI 查询失败')); return;
          }
          if (!('result' in message)) { finish(failure('unavailable', 'Codex 官方 CLI 响应无效')); return; }
          if (phase === 1) { phase = 2; send({ method: 'initialized', params: {} }); send({ id: 2, method: 'account/rateLimits/read' }); }
          else { finish(mapResponse(message.result)); return; }
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'quotern', version: '1.0.0' } } });
    });
  };
}

export const readCodexOfficial = (directory?:string) => createCodexOfficialReader({
  find: findCodex,
  spawn: executable => spawnProcess(executable, ['app-server', '--listen', 'stdio://'], { env: {...guiCliEnvironment(), ...(directory ? { CODEX_HOME:directory } : {})}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }),
  timeoutMs: 15_000,
})();
