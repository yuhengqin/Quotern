import type { SupportedLocale } from 'quotern-i18n';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export interface ContextSample { sessionId: string; percent: number; at: number }

export function contextPercent(payload: unknown): number | null {
  const context = obj(obj(payload).context_window), usage = obj(context.current_usage);
  if (finite(context.used_percentage)) return Math.min(100, context.used_percentage);
  const counts = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens];
  if (!finite(context.context_window_size) || context.context_window_size === 0 || !counts.some(finite)) return null;
  return Math.min(100, counts.reduce<number>((sum, value) => sum + (finite(value) ? value : 0), 0) / context.context_window_size * 100);
}

export function contextSample(payload: unknown, now = Date.now()): ContextSample | null {
  const id = obj(payload).session_id, percent = contextPercent(payload);
  return typeof id === 'string' && /^[\w.-]{1,160}$/.test(id) && percent !== null ? { sessionId: id, percent, at: now } : null;
}

const messages: Record<SupportedLocale, readonly string[]> = {
  'zh-CN': ['缓存', '冷缓存', '接近上限，考虑 /compact', '上下文增长较快', '可能原因', '工具变更', '系统指令变更', '缓存过期', '服务端变化'],
  en: ['cache', 'cold cache', 'near limit; consider /compact', 'context growing quickly', 'possible cause', 'tools changed', 'system prompt changed', 'cache expired', 'server-side change'],
  ja: ['キャッシュ', 'コールドキャッシュ', '上限に近い：/compact を検討', 'コンテキストが急増', '考えられる原因', 'ツールの変更', 'システム指示の変更', 'キャッシュ期限切れ', 'サーバー側の変更'],
  ko: ['캐시', '콜드 캐시', '한도 임박: /compact 고려', '컨텍스트 빠르게 증가', '가능한 원인', '도구 변경', '시스템 지침 변경', '캐시 만료', '서버 측 변경'],
};

/** Host observations only. Cause names are an allowlist, never arbitrary terminal text. */
export function statuslineDiagnostics(payload: unknown, locale: SupportedLocale, previous?: ContextSample | null, now = Date.now()): string[] {
  const data = obj(payload), cache = obj(data.prompt_cache), w = messages[locale], parts: string[] = [];
  const percent = contextPercent(payload), current = contextSample(payload, now);
  if (percent !== null && percent >= 80) parts.push(w[2]!);
  else if (current && previous?.sessionId === current.sessionId && finite(previous.percent) && previous.percent <= 100 && finite(previous.at)
    && now - previous.at >= 5000 && now - previous.at <= 120000 && current.percent - previous.percent >= 15) parts.push(w[3]!);
  if (finite(cache.hit_ratio) && cache.hit_ratio <= 1) parts.push(`${w[0]} ${Math.round(cache.hit_ratio * 100)}%`);
  if (cache.caching_observed === true && (cache.warm === false || (finite(cache.expires_at) && cache.expires_at * 1000 <= now))) parts.push(w[1]!);
  if (finite(cache.last_miss_at) && now / 1000 >= cache.last_miss_at && now / 1000 - cache.last_miss_at <= 300) {
    const causes = obj(cache.last_miss_cause).causes;
    const names: Record<string, number> = { tools_changed: 5, system_prompt_changed: 6, ttl_expired_5m: 7, ttl_expired_1h: 7, likely_server_side: 8 };
    if (Array.isArray(causes)) {
      const descriptions = [...new Set(causes.flatMap(cause => typeof cause === 'string' && Object.hasOwn(names, cause) ? [w[names[cause]!]!] : []))];
      if (descriptions.length) parts.push(`${w[4]}: ${descriptions.slice(0, 2).join(', ')}`);
    }
  }
  return parts;
}
