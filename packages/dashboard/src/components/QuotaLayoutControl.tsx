import { useState } from 'react';
import { Button, Checkbox, Popover } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import type { QuotaPreferences, QuotaPreferencePatch, QuotaProviderState } from 'quotern-core/quota/shared/quota';
import { FilterMenuPopover } from './FilterMenu';
const rows = { 'quota.layout': ['额度排列', 'Quota layout', '使用枠の配置', '할당량 배치'], 'quota.compact': ['紧凑卡片', 'Compact cards', 'コンパクト表示', '간결한 카드'], 'quota.up': ['上移 {{name}}', 'Move {{name}} up', '{{name}} を上へ', '{{name}} 위로'], 'quota.down': ['下移 {{name}}', 'Move {{name}} down', '{{name}} を下へ', '{{name}} 아래로'], 'quota.favorite': ['优先显示 {{name}}', 'Prioritize {{name}}', '{{name}} を優先表示', '{{name}} 먼저 표시'], 'quota.layoutFailed': ['排列保存失败，请重试。', 'Could not save layout. Retry.', '配置を保存できません。再試行してください。', '배치를 저장하지 못했습니다. 다시 시도하세요.'] };
const at = (i: number) => Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value[i]!]));
registerMessages({ 'zh-CN': at(0), en: at(1), ja: at(2), ko: at(3) });
export function orderQuotaProviders<T extends { id: string }>(providers: readonly T[], order: readonly string[] = []): T[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...providers].sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}
export function QuotaLayoutControl({ providers, preferences, onSave }: { providers: QuotaProviderState[]; preferences: QuotaPreferences; onSave(patch: QuotaPreferencePatch): Promise<unknown> }) {
  const { t } = useTranslation(), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const ordered = orderQuotaProviders(providers, preferences.providerOrder);
  const save = async (patch: QuotaPreferencePatch) => { if (busy) return; setBusy(true); setError(false); try { await onSave(patch); } catch { setError(true); } finally { setBusy(false); } };
  const move = (index: number, delta: number) => { if (busy || index + delta < 0 || index + delta >= ordered.length) return; const ids = ordered.map(p => p.id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; void save({ providerOrder: ids }); };
  return <Popover><Button size="sm" variant="tertiary">{t('quota.layout')}</Button><FilterMenuPopover className="w-80" header={<><Popover.Heading className="sr-only">{t('quota.layout')}</Popover.Heading><Checkbox isSelected={preferences.compact ?? false} isReadOnly={busy} onChange={compact => { void save({ compact }); }}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('quota.compact')}</Checkbox.Content></Checkbox></>}>
    <div className="space-y-1 p-1">{ordered.map((provider, index) => { const name = [provider.label, provider.profileLabel].filter(Boolean).join(' · '); return <div key={provider.id} className="flex items-center gap-1 text-xs"><span className="min-w-0 flex-1 break-words">{name}</span>
      <Button size="sm" variant="tertiary" isIconOnly aria-label={t('quota.favorite', { name })} aria-disabled={busy || index === 0} onPress={() => { if (index > 0) void save({ providerOrder: [provider.id, ...ordered.filter(p => p.id !== provider.id).map(p => p.id)] }); }}>★</Button>
      <Button size="sm" variant="tertiary" isIconOnly aria-label={t('quota.up', { name })} aria-disabled={busy || index === 0} onPress={() => move(index, -1)}>↑</Button><Button size="sm" variant="tertiary" isIconOnly aria-label={t('quota.down', { name })} aria-disabled={busy || index === ordered.length - 1} onPress={() => move(index, 1)}>↓</Button>
    </div>; })}{error && <p role="alert" className="text-xs text-danger">{t('quota.layoutFailed')}</p>}</div>
  </FilterMenuPopover></Popover>;
}
