import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Checkbox, Popover } from '@heroui/react';
import { GripVertical, MoreHorizontal, Pencil } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import type { QuotaProviderState } from 'quotern-core/quota/shared/quota';
import type { QuotaLayoutEditor } from '../hooks/useQuotaLayout';
import { useQuotaLayoutDrag } from '../hooks/useQuotaLayoutDrag';
import { FilterMenuPopover } from './FilterMenu';
import { isQuotaStatusOnly } from '../lib/quota-presentation';
import { quotaLayoutGroups } from '../lib/quota-layout';
import './quota-layout.css';
export { orderQuotaProviders } from '../lib/quota-layout';

const rows = {
  'quota.layout': ['编辑布局', 'Edit layout', 'レイアウトを編集', '레이아웃 편집'],
  'quota.compact': ['紧凑卡片', 'Compact cards', 'コンパクト表示', '간결한 카드'],
  'quota.up': ['上移', 'Move earlier', '前へ移動', '앞으로 이동'],
  'quota.down': ['下移', 'Move later', '後へ移動', '뒤로 이동'],
  'quota.first': ['移到最前', 'Move to first', '先頭へ移動', '맨 앞으로 이동'],
  'quota.moveMenu': ['移动 {{name}}', 'Move {{name}}', '{{name}} を移動', '{{name}} 이동'],
  'quota.drag': ['拖动 {{name}} 调整位置', 'Drag to move {{name}}', '{{name}} をドラッグして移動', '{{name}} 끌어서 이동'],
  'quota.hint': ['拖动卡片调整顺序，也可使用移动菜单。', 'Drag a card or use its move menu.', 'カードをドラッグするか、移動メニューを使います。', '카드를 끌거나 이동 메뉴를 사용하세요.'],
  'quota.done': ['完成', 'Done', '完了', '완료'],
  'quota.cancel': ['取消', 'Cancel', 'キャンセル', '취소'],
  'quota.saving': ['保存中…', 'Saving…', '保存中…', '저장 중…'],
  'quota.retrySave': ['重试保存', 'Retry saving', '保存を再試行', '저장 재시도'],
  'quota.layoutFailed': ['排列保存失败，请重试。', 'Could not save layout. Retry.', '配置を保存できません。再試行してください。', '배치를 저장하지 못했습니다. 다시 시도하세요.'],
  'quota.layoutSaved': ['额度排列已保存。', 'Quota layout saved.', '使用枠の配置を保存しました。', '할당량 배치를 저장했습니다.'],
  'quota.moved': ['{{name}} 已移到第 {{position}} 位，共 {{count}} 项。', '{{name}} moved to position {{position}} of {{count}}.', '{{name}} を {{count}} 件中 {{position}} 番目に移動しました。', '{{name}}을(를) {{count}}개 중 {{position}}번째로 이동했습니다.'],
};
const at = (i: number) => Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value[i]!]));
registerMessages({ 'zh-CN': at(0), en: at(1), ja: at(2), ko: at(3) });

export function QuotaLayoutControl({ editor }: { editor: QuotaLayoutEditor }) {
  const { t } = useTranslation();
  return <>
    {editor.editing ? <>
      <p className="min-w-0 flex-1 text-xs text-muted">{t('quota.hint')}</p>
      <Checkbox isSelected={editor.compact} isDisabled={editor.busy} onChange={editor.setCompact} className="shrink-0 text-xs"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('quota.compact')}</Checkbox.Content></Checkbox>
      <Button size="sm" variant="tertiary" isDisabled={editor.busy} onPress={editor.cancel}>{t('quota.cancel')}</Button>
      <Button size="sm" isDisabled={editor.busy} onPress={() => void editor.finish()}>{t(editor.busy ? 'quota.saving' : editor.error ? 'quota.retrySave' : 'quota.done')}</Button>
    </> : <Button ref={editor.triggerRef} size="sm" variant="tertiary" onPress={editor.start}><Pencil size={14} aria-hidden="true" />{t('quota.layout')}</Button>}
    {editor.error && <p role="alert" className="w-full text-right text-xs text-danger">{t('quota.layoutFailed')}</p>}
    <span role="status" className="sr-only">{editor.announcement}</span>
  </>;
}

type QuotaLayoutControls = { handle: ReactNode; menu: ReactNode };

export function QuotaLayoutCards({ editor, children }: { editor: QuotaLayoutEditor; children: (provider: QuotaProviderState, controls: QuotaLayoutControls | undefined, statusRow: boolean) => ReactNode }) {
  const { t } = useTranslation();
  const openProvider = useRef<string | null>(null), previousGroups = useRef(new Map<string, string>());
  useEffect(() => {
    const trackDialog = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; open: boolean }>).detail;
      if (typeof detail?.id !== 'string') return;
      if (detail.open) openProvider.current = detail.id;
      else if (openProvider.current === detail.id) openProvider.current = null;
    };
    window.addEventListener('quotern:quota-dialog', trackDialog);
    return () => window.removeEventListener('quotern:quota-dialog', trackDialog);
  }, []);
  const groups = quotaLayoutGroups(editor.ordered, isQuotaStatusOnly);
  // Keep an open detail's React parent when other subscriptions split or merge its group.
  const activeGroup = groups.find(group => group.statusOnly && group.providers.some(provider => provider.id === openProvider.current));
  const retainedKey = activeGroup && openProvider.current ? previousGroups.current.get(openProvider.current) : undefined;
  const usedKeys = new Set(retainedKey ? [retainedKey] : []);
  const stableGroups = groups.map(group => {
    if (!group.statusOnly) return group;
    if (group === activeGroup && retainedKey) return { ...group, key: retainedKey };
    let key = group.key, suffix = 0;
    while (usedKeys.has(key)) key = `${group.key}:${++suffix}`;
    usedKeys.add(key);
    return { ...group, key };
  });
  useLayoutEffect(() => { previousGroups.current = new Map(stableGroups.filter(group => group.statusOnly).flatMap(group => group.providers.map(provider => [provider.id, group.key]))); });
  const onlyStatuses = groups.every(group => group.statusOnly);
  const render = (provider: QuotaProviderState, statusRow: boolean) => <QuotaLayoutItem key={provider.id} provider={provider} editor={editor} statusRow={statusRow}>{controls => children(provider, controls, statusRow)}</QuotaLayoutItem>;
  return stableGroups.map(group => group.statusOnly
    ? <Card key={group.key} data-quota-status-group={group.key} role="group" aria-label={t('usage.quota.statusGroup')} variant="secondary" className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${onlyStatuses ? 'col-span-full grid-cols-subgrid' : ''}`.trim()}>{group.providers.map(provider => render(provider, true))}</Card>
    : render(group.providers[0], false));
}

function QuotaLayoutItem({ editor, provider, children, statusRow }: { editor: QuotaLayoutEditor; provider: QuotaProviderState; statusRow: boolean; children: (controls: QuotaLayoutControls | undefined) => ReactNode }) {
  const { t } = useTranslation(), [menuOpen, setMenuOpen] = useState(false);
  const drag = useQuotaLayoutDrag(provider.id, editor);
  const index = editor.ordered.findIndex(item => item.id === provider.id);
  const name = [provider.label, provider.profileLabel].filter(Boolean).join(' · ');
  const target = editor.dropTarget?.id === provider.id ? editor.dropTarget : null;
  const move = (action: 'first' | 'up' | 'down') => {
    const destination = action === 'first' ? editor.ordered[0] : editor.ordered[index + (action === 'up' ? -1 : 1)];
    if (destination) editor.move(provider.id, destination.id, action === 'down' ? 'after' : 'before');
    setMenuOpen(false);
    editor.focusItem(provider.id);
  };
  const controls = editor.editing ? {
    handle: <button ref={drag.handleRef} type="button" data-quota-action data-quota-drag-handle aria-label={t('quota.drag', { name })} title={t('quota.drag', { name })}
      disabled={editor.busy} className="quota-drag-handle"
      onClick={event => { event.stopPropagation(); if (!drag.suppressClick.current) setMenuOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !editor.dragOwner.current) { event.preventDefault(); editor.cancel(); }
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'End') { const last = editor.ordered.at(-1); if (last) editor.move(provider.id, last.id, 'after'); editor.focusItem(provider.id); }
          else move(event.key === 'Home' ? 'first' : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? 'up' : 'down');
        }
      }}><GripVertical size={16} aria-hidden="true" /></button>,
    menu: <Popover isOpen={menuOpen} onOpenChange={setMenuOpen}><Button data-quota-action size="sm" variant="tertiary" isIconOnly isDisabled={editor.busy} aria-label={t('quota.moveMenu', { name })}><MoreHorizontal size={16} aria-hidden="true" /></Button>
      <FilterMenuPopover className="w-40" header={<Popover.Heading className="sr-only">{t('quota.moveMenu', { name })}</Popover.Heading>}>
        <div className="flex flex-col gap-1 p-1">{(['first', 'up', 'down'] as const).map(action => <Button key={action} size="sm" variant="ghost" className="justify-start" isDisabled={editor.busy || (action === 'down' ? index === editor.ordered.length - 1 : index === 0)} onPress={() => move(action)}>{t(`quota.${action}`)}</Button>)}</div>
      </FilterMenuPopover></Popover>,
  } : undefined;
  return <div ref={drag.itemRef} data-quota-layout-item={provider.id} data-editing={editor.editing || undefined} data-status-row={statusRow || undefined} data-dragging={Boolean(drag.offset) || undefined} data-compact={statusRow || editor.compact || undefined} className="quota-layout-item" onPointerDown={drag.onPointerDown}
    onClickCapture={event => { if (drag.suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
    <div className="quota-layout-preview" style={drag.offset ? { transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`, pointerEvents: 'none' } : undefined}>{children(controls)}</div>
    {target && <span aria-hidden="true" data-quota-drop-indicator data-axis={target.axis} data-placement={target.placement} className="quota-drop-indicator" />}
  </div>;
}
