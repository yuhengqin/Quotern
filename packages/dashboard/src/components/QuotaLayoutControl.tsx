import { useState, type ReactNode } from 'react';
import { Button, Checkbox, Popover } from '@heroui/react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import type { QuotaProviderState } from 'quotern-core/quota/shared/quota';
import type { QuotaLayoutEditor } from '../hooks/useQuotaLayout';
import { useQuotaLayoutDrag } from '../hooks/useQuotaLayoutDrag';
import { FilterMenuPopover } from './FilterMenu';
import './quota-layout.css';
export { orderQuotaProviders } from '../lib/quota-layout';

const rows = {
  'quota.layout': ['额度排列', 'Arrange quota cards', '使用枠の配置', '할당량 배치'],
  'quota.compact': ['紧凑卡片', 'Compact cards', 'コンパクト表示', '간결한 카드'],
  'quota.up': ['上移', 'Move earlier', '前へ移動', '앞으로 이동'],
  'quota.down': ['下移', 'Move later', '後へ移動', '뒤로 이동'],
  'quota.first': ['移到最前', 'Move to first', '先頭へ移動', '맨 앞으로 이동'],
  'quota.moveMenu': ['移动 {{name}}', 'Move {{name}}', '{{name}} を移動', '{{name}} 이동'],
  'quota.drag': ['拖动 {{name}} 调整位置', 'Drag to move {{name}}', '{{name}} をドラッグして移動', '{{name}} 끌어서 이동'],
  'quota.hint': ['拖动标题把手调整顺序，也可使用移动菜单。', 'Drag a title handle or use its move menu.', '見出しのハンドルをドラッグするか、移動メニューを使います。', '제목 핸들을 끌거나 이동 메뉴를 사용하세요.'],
  'quota.statusFixed': ['状态卡固定显示在额度卡之后。', 'Status cards stay after quota cards.', '状態カードは使用枠カードの後に表示されます。', '상태 카드는 할당량 카드 뒤에 표시됩니다.'],
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

export function QuotaLayoutControl({ editor, hasStatuses }: { editor: QuotaLayoutEditor; hasStatuses: boolean }) {
  const { t } = useTranslation();
  return <>
    {editor.editing ? <>
      <p className="min-w-0 flex-1 text-xs text-muted">{t('quota.hint')}{hasStatuses && <> {t('quota.statusFixed')}</>}</p>
      <Checkbox isSelected={editor.compact} isDisabled={editor.busy} onChange={editor.setCompact} className="shrink-0 text-xs"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('quota.compact')}</Checkbox.Content></Checkbox>
      <Button size="sm" variant="tertiary" isDisabled={editor.busy} onPress={editor.cancel}>{t('quota.cancel')}</Button>
      <Button size="sm" isDisabled={editor.busy} onPress={() => void editor.finish()}>{t(editor.busy ? 'quota.saving' : editor.error ? 'quota.retrySave' : 'quota.done')}</Button>
    </> : <Button ref={editor.triggerRef} size="sm" variant="tertiary" onPress={editor.start}>{t('quota.layout')}</Button>}
    {editor.error && <p role="alert" className="w-full text-right text-xs text-danger">{t('quota.layoutFailed')}</p>}
    <span role="status" className="sr-only">{editor.announcement}</span>
  </>;
}

export function QuotaLayoutItem({ editor, provider, children }: { editor: QuotaLayoutEditor; provider: QuotaProviderState; children: (controls: { handle: ReactNode; menu: ReactNode } | undefined) => ReactNode }) {
  const { t } = useTranslation(), [menuOpen, setMenuOpen] = useState(false);
  const drag = useQuotaLayoutDrag(provider.id, editor);
  const index = editor.ordered.findIndex(item => item.id === provider.id);
  const name = [provider.label, provider.profileLabel].filter(Boolean).join(' · ');
  const target = editor.dropTarget?.id === provider.id ? editor.dropTarget : null;
  const move = (action: 'first' | 'up' | 'down') => {
    const destination = action === 'first' ? editor.ordered[0] : editor.ordered[index + (action === 'up' ? -1 : 1)];
    if (destination) editor.move(provider.id, destination.id, action === 'down' ? 'after' : 'before');
    setMenuOpen(false);
    requestAnimationFrame(() => { drag.itemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); drag.handleRef.current?.focus({ preventScroll: true }); });
  };
  const controls = editor.editing ? {
    handle: <button ref={drag.handleRef} type="button" data-quota-action data-quota-drag-handle aria-label={t('quota.drag', { name })} title={t('quota.drag', { name })}
      disabled={editor.busy} className="quota-drag-handle" onPointerDown={drag.onPointerDown}
      onClick={event => { event.stopPropagation(); if (!drag.suppressClick.current) setMenuOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !editor.dragOwner.current) { event.preventDefault(); editor.cancel(); }
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'End') { const last = editor.ordered.at(-1); if (last) editor.move(provider.id, last.id, 'after'); requestAnimationFrame(() => drag.handleRef.current?.focus({ preventScroll: true })); }
          else move(event.key === 'Home' ? 'first' : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? 'up' : 'down');
        }
      }}><GripVertical size={16} aria-hidden="true" /></button>,
    menu: <Popover isOpen={menuOpen} onOpenChange={setMenuOpen}><Button data-quota-action size="sm" variant="tertiary" isIconOnly isDisabled={editor.busy} aria-label={t('quota.moveMenu', { name })}><MoreHorizontal size={16} aria-hidden="true" /></Button>
      <FilterMenuPopover className="w-40" header={<Popover.Heading className="sr-only">{t('quota.moveMenu', { name })}</Popover.Heading>}>
        <div className="flex flex-col gap-1 p-1">{(['first', 'up', 'down'] as const).map(action => <Button key={action} size="sm" variant="ghost" className="justify-start" isDisabled={editor.busy || (action === 'down' ? index === editor.ordered.length - 1 : index === 0)} onPress={() => move(action)}>{t(`quota.${action}`)}</Button>)}</div>
      </FilterMenuPopover></Popover>,
  } : undefined;
  return <div ref={drag.itemRef} data-quota-layout-item={provider.id} data-editing={editor.editing || undefined} data-dragging={Boolean(drag.offset) || undefined} data-compact={editor.compact || undefined} className="quota-layout-item">
    <div className="quota-layout-preview" style={drag.offset ? { transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`, pointerEvents: 'none' } : undefined}>{children(controls)}</div>
    {target && <span aria-hidden="true" data-quota-drop-indicator data-axis={target.axis} data-placement={target.placement} className="quota-drop-indicator" />}
  </div>;
}
