import { useId, useState } from 'react';
import { Button, Input, Label, ListBox, Pagination, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { FilterSelectPopover } from './FilterMenu';
import { paginationItems, parsePageJump } from '../lib/session-list-query';

interface Props {
  page: number; pages: number; pageSize: number; totalRoots: number; loading?: boolean;
  onChange(patch: { page?: number; pageSize?: number }): void;
}

export function SessionPagination({ page, pages, pageSize, totalRoots, loading, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [jump, setJump] = useState('');
  const target = parsePageJump(jump, pages);
  const first = totalRoots ? (page - 1) * pageSize + 1 : 0;
  return <footer className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-separator pt-4">
    <Pagination size="sm" aria-label={t('usage.activity.pagination')} className="min-w-0 flex-1 flex-wrap gap-3">
      <Pagination.Summary className="text-xs tabular-nums text-muted">{t('usage.activity.rootPageRange', { from: first, to: Math.min(page * pageSize, totalRoots), total: totalRoots })}</Pagination.Summary>
      <Pagination.Content className="flex-wrap gap-1">
        <Pagination.Item><Pagination.Previous aria-label={t('usage.activity.previousPage')} isDisabled={page <= 1 || loading} onPress={() => onChange({ page: page - 1 })}><Pagination.PreviousIcon /><span className="sr-only sm:not-sr-only">{t('usage.activity.previousPage')}</span></Pagination.Previous></Pagination.Item>
        {paginationItems(pages, page).map((item, index) => <Pagination.Item key={item === 'ellipsis' ? `gap-${index}` : item}>{item === 'ellipsis' ? <Pagination.Ellipsis /> : <Pagination.Link isActive={item === page} isDisabled={loading} aria-label={t('usage.activity.goToPage', { page: item })} onPress={() => onChange({ page: item })}>{item}</Pagination.Link>}</Pagination.Item>)}
        <Pagination.Item><Pagination.Next aria-label={t('usage.activity.nextPage')} isDisabled={page >= pages || loading} onPress={() => onChange({ page: page + 1 })}><span className="sr-only sm:not-sr-only">{t('usage.activity.nextPage')}</span><Pagination.NextIcon /></Pagination.Next></Pagination.Item>
      </Pagination.Content>
    </Pagination>
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Select aria-label={t('usage.activity.pageSize')} value={String(pageSize)} onChange={value => onChange({ pageSize: Number(value) })} variant="secondary" className="w-32" isDisabled={loading}>
        <Label className="sr-only">{t('usage.activity.pageSize')}</Label>
        <Select.Trigger className="!h-8 !min-h-8 !items-center !py-0 !text-xs"><Select.Value className="!text-xs !leading-4" /><Select.Indicator /></Select.Trigger>
        <FilterSelectPopover><ListBox>{[12, 24, 48].map(size => <ListBox.Item key={size} id={String(size)} textValue={t('usage.activity.perPage', { count: size })}>{t('usage.activity.perPage', { count: size })}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
      </Select>
      <form className="flex items-center gap-2" noValidate onSubmit={event => { event.preventDefault(); if (target !== null) { onChange({ page: target }); setJump(''); } }}>
        <label htmlFor={id} className="text-xs text-muted">{t('usage.activity.jumpPage')}</label>
        <Input id={id} inputMode="numeric" value={jump} onChange={event => setJump(event.target.value)} className="!h-8 !min-h-8 w-14 !px-2 !text-xs tabular-nums" autoComplete="off" />
        <Button type="submit" size="sm" variant="secondary" className="!h-8 !min-h-8" isDisabled={target === null || loading}>{t('usage.activity.jump')}</Button>
      </form>
    </div>
  </footer>;
}
