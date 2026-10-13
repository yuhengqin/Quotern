import { Button, Label, ListBox, Modal, Select, Spinner } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import { useShareSnapshot, type ShareSnapshot } from '../hooks/ShareSnapshotContext';
import { useShareData } from '../hooks/useShareData';
import { OPEN_SHARE_EVENT } from '@/lib/shell-events';
import { buildShareSnapshot, SHARE_RANGE_OPTIONS, type ShareFilters } from '../lib/share-snapshot';
import { normalizeSourceId } from '../lib/usage-filter';
import { ToolChannelSelect } from './DashboardFilter';
import { getShareCardVariant, ShareCardCarousel } from './ShareCardCarousel';
import { ShareCardActions } from './ShareCardActions';

/** Each opening captures the dashboard scope, then owns an independent share session. */
export function ShareActivityModal() {
  const [session, setSession] = useState<{ snapshot: ShareSnapshot | null } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { snapshot } = useShareSnapshot();

  useEffect(() => {
    const open = () => setSession({ snapshot });
    window.addEventListener(OPEN_SHARE_EVENT, open);
    return () => window.removeEventListener(OPEN_SHARE_EVENT, open);
  }, [snapshot]);

  return (
    <Modal.Backdrop isOpen={session !== null} onOpenChange={(open) => { if (!open) setSession(null); }}>
      <Modal.Container className="p-4 sm:p-4" scroll="inside" size="lg">
        <Modal.Dialog aria-label="分享" className="max-h-[90dvh] overflow-hidden p-4 sm:max-w-[720px] sm:p-5">
          <Modal.CloseTrigger aria-label="关闭分享" />
          {session && <ShareSession activeIndex={activeIndex} initial={session.snapshot} onActiveIndexChange={setActiveIndex} />}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ShareSession({ initial, activeIndex, onActiveIndexChange }: {
  initial: ShareSnapshot | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}) {
  const [filters, setFilters] = useState<ShareFilters>(() => ({
    rangeDays: initial?.filters.rangeDays ?? 7,
    selectedDate: initial?.filters.selectedDate ?? null,
    selectedSources: [...new Set((initial?.filters.selectedSources ?? []).map(normalizeSourceId))],
  }));
  const { data, loading, error, retry } = useShareData(initial, filters.rangeDays, filters.selectedDate);
  const preview = useMemo(() => data ? buildShareSnapshot(data, filters) : null, [data, filters]);
  const sources = [...new Set([
    ...(initial && !initial.loading && !initial.error ? initial.details?.sources ?? [] : []),
    ...filters.selectedSources,
    ...(preview?.tools.map((tool) => tool.source) ?? []),
  ].map(normalizeSourceId))];
  const inheritedDate = initial?.filters.selectedDate;
  const rangeValue = filters.selectedDate ? `date:${filters.selectedDate}` : String(filters.rangeDays);
  const rangeLabel = filters.selectedDate ?? SHARE_RANGE_OPTIONS.find((option) => option.days === filters.rangeDays)?.label;
  const disabled = loading || error !== null || !preview;

  return (
    <>
      <Modal.Header className="px-0 pb-3 pr-8 sm:px-2">
        <Modal.Heading className="text-base">分享用量报告</Modal.Heading>
      </Modal.Header>
      <Modal.Body className="px-0 pb-0 pt-0 sm:px-2">
        <div className="flex flex-wrap items-center justify-center gap-2 pb-3" aria-label="分享筛选条件">
          <Select
            aria-label="分享日期范围"
            className="w-fit text-xs"
            value={rangeValue}
            variant="secondary"
            onChange={(key) => {
              if (key == null) return;
              const selectedDate = String(key).startsWith('date:') ? inheritedDate ?? null : null;
              const rangeDays = selectedDate ? initial!.filters.rangeDays : Number(key);
              setFilters((current) => ({ ...current, rangeDays, selectedDate }));
            }}
          >
            <Label className="sr-only">日期范围</Label>
            <Select.Trigger className="!h-8 !min-h-8 !w-fit ps-3 pe-8 !text-xs">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="w-44" placement="bottom start">
              <ListBox aria-label="分享日期范围选项">
                {SHARE_RANGE_OPTIONS.map((option) => (
                  <ListBox.Item id={String(option.days)} key={option.days} textValue={option.label}>
                    {option.label}<ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
                {inheritedDate && (
                  <ListBox.Item id={`date:${inheritedDate}`} textValue={inheritedDate}>
                    {inheritedDate}<ListBox.ItemIndicator />
                  </ListBox.Item>
                )}
              </ListBox>
            </Select.Popover>
          </Select>
          <ToolChannelSelect
            ariaLabel="分享 Agent"
            tools={sources.map((source) => ({ source }))}
            selectedTools={filters.selectedSources}
            onChange={(selectedSources) => setFilters((current) => ({ ...current, selectedSources }))}
          />
        </div>
        <div className="relative" aria-busy={loading}>
          <ShareCardCarousel activeIndex={activeIndex} onActiveIndexChange={onActiveIndexChange}
            rangeLabel={rangeLabel} reservedHeight={224} summary={preview?.summary ?? null}
            details={preview?.details} toolLabel={preview?.toolLabel} />
          {disabled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/90 p-6 text-center" role="status" aria-live="polite">
              {loading ? <><Spinner size="sm" /><span className="text-sm text-muted">正在更新分享预览…</span></> : <>
                <p className="text-sm text-muted">{error || '暂无分享数据'}</p>
                <Button size="sm" variant="secondary" onPress={retry}>重试</Button>
              </>}
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer className="mt-3 shrink-0 justify-center">
        <ShareCardActions color={getShareCardVariant(activeIndex).color} rangeLabel={rangeLabel}
          summary={preview?.summary ?? null} details={preview?.details} toolLabel={preview?.toolLabel} disabled={disabled} />
      </Modal.Footer>
    </>
  );
}
