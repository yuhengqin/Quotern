import { Button, Input, Label, ListBox, Modal, Select, Spinner, TextField } from '@heroui/react';
import { useMemo, useState } from 'react';
import { normalizeLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { type ShareSnapshot } from '../hooks/ShareSnapshotContext';
import { useShareData } from '../hooks/useShareData';
import { useShareBackgrounds } from '../hooks/useShareBackgrounds';
import { buildShareSnapshot, SHARE_RANGE_OPTIONS, shareRangeLabel, type ShareFilters } from '../lib/share-snapshot';
import { normalizeSourceId } from '../lib/usage-filter';
import { MAX_SHARE_BACKGROUNDS } from '../lib/share-backgrounds';
import { ToolChannelSelect } from './DashboardFilter';
import { getShareCardVariant, SHARE_CARD_VARIANTS, ShareCardCarousel, type ShareCardVariant } from './ShareCardCarousel';
import { ShareCardActions } from './ShareCardActions';
import { ShareBackgroundPicker } from './ShareBackgroundPicker';
import { FilterSelectPopover } from './FilterMenu';
import { useShareReport } from '../hooks/useShareReport';
import { buildShareCaption, DEFAULT_SHARE_PRESENTATION, shareCostText, type ShareAspect, type SharePresentation } from '../lib/share-presentation';
import { formatTokens, formatUsd } from '../lib/format';

import { registerMessages } from 'quotern-i18n';
import { shareMessages } from '../i18n/share-messages';

registerMessages(shareMessages);

export function ShareSession({ initial, activeIndex, onActiveIndexChange }: {
  initial: ShareSnapshot | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
  const backgrounds = useShareBackgrounds();
  const [presentation, setPresentation] = useState<SharePresentation>(DEFAULT_SHARE_PRESENTATION);
  const [userName, setUserName] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const variants = useMemo<ShareCardVariant[]>(() => [...SHARE_CARD_VARIANTS.map((variant) => ({ ...variant, label: t(`share.variant.${variant.id}`) })), ...(backgrounds.ready ? backgrounds.items : []).map((item) => ({
    id: item.id, label: item.name, color: '#100b35', theme: 'custom' as const, backgroundImage: item.image,
  }))], [backgrounds.items, backgrounds.ready, locale, t]);
  const customIndex = variants.findIndex((variant) => variant.id === backgrounds.selectedId);
  const currentIndex = customIndex >= 0 ? customIndex : activeIndex;
  const currentVariant = getShareCardVariant(currentIndex, variants);
  const selectVariant = (index: number) => {
    setDeletingId(null);
    setSelectionRevision((revision) => revision + 1);
    if (index < SHARE_CARD_VARIANTS.length) {
      backgrounds.select(null);
      onActiveIndexChange(index);
    } else { backgrounds.select(variants[index].id); }
  };
  const [filters, setFilters] = useState<ShareFilters>(() => ({
    rangeDays: initial?.filters.rangeDays ?? 7,
    selectedDate: initial?.filters.selectedDate ?? null,
    dateRange: initial?.filters.dateRange ?? null,
    selectedSources: [...new Set((initial?.filters.selectedSources ?? []).map(normalizeSourceId))],
  }));
  const { data, loading, error, retry } = useShareData(initial, filters.rangeDays, filters.selectedDate, filters.dateRange);
  const cost = useShareReport(filters, Boolean(data) && !loading && !error);
  const preview = useMemo(() => {
    if (!data) return null;
    const snapshot = buildShareSnapshot(data, filters, locale);
    const report = cost.report;
    if (!report?.breakdowns) return snapshot;
    return { ...snapshot,
      summary: { ...snapshot.summary, totalTokens: report.summary.tokens, totalCostUsd: report.summary.knownCostUsd,
        inputTokens: report.summary.inputTokens, outputTokens: report.summary.outputTokens,
        cachedInputTokens: report.summary.cacheReadTokens, cacheCreationInputTokens: report.summary.cacheWriteTokens },
      details: {
        sources: [...new Set(report.breakdowns.models.flatMap(row => row.source ? [row.source] : []))],
        days: report.breakdowns.daily.map(row => ({ date: row.key, tokens: row.tokens })),
        models: report.breakdowns.models.map(row => ({ model: row.model ?? row.label, tokens: row.tokens })),
      },
    };
  }, [data, filters, locale, cost.report]);
  const costEvidence = data && !loading && !error && cost.report?.breakdowns && !cost.loading ? {
    knownCostUsd: cost.report.summary.knownCostUsd, tokens: cost.report.summary.tokens, unpricedTokens: cost.report.summary.costExplanation.unpricedTokens,
  } : null;
  const sources = [...new Set([
    ...(initial && !initial.loading && !initial.error ? initial.details?.sources ?? [] : []),
    ...filters.selectedSources,
    ...(preview?.tools.map((tool) => tool.source) ?? []),
  ].map(normalizeSourceId))];
  const inheritedDate = initial?.filters.selectedDate;
  const inheritedRange = initial?.filters.dateRange;
  const rangeValue = filters.selectedDate ? `date:${filters.selectedDate}` : filters.dateRange ? 'custom' : String(filters.rangeDays);
  const rangeLabel = filters.selectedDate ?? shareRangeLabel(filters.rangeDays, locale, filters.dateRange);
  const inheritedRangeLabel = shareRangeLabel(initial?.filters.rangeDays ?? 1, locale, inheritedRange);
  const disabled = loading || cost.loading || error !== null || !preview;
  const copyCaption = async () => {
    if (!preview || disabled) return;
    const text = buildShareCaption({ userName, rangeLabel, toolLabel: preview.toolLabel, metrics: [
      [t('share.poster.estimatedCost'), shareCostText(costEvidence, formatUsd, t('island.share.partialCost'))],
      [t('share.poster.totalTokens'), formatTokens(preview.summary.totalTokens)],
      ...(presentation.layout === 'details' ? [[t('share.poster.inputTokens'), formatTokens(preview.summary.inputTokens)], [t('share.poster.outputTokens'), formatTokens(preview.summary.outputTokens)]] as [string, string][] : []),
    ] });
    try { await navigator.clipboard.writeText(text); setCopyState('done'); } catch { setCopyState('failed'); }
  };

  return (
    <>
      <Modal.Body className="px-0 pb-0 pt-0 sm:px-2">
        <div className="flex flex-wrap items-center justify-center gap-2 pb-3" aria-label={t('share.filterGroup')}>
          <Select
            aria-label={t('share.dateRange')}
            className="w-fit text-xs"
            value={rangeValue}
            variant="secondary"
            onChange={(key) => {
              if (key == null) return;
              const selectedDate = String(key).startsWith('date:') ? inheritedDate ?? null : null;
              const dateRange = String(key) === 'custom' || selectedDate ? inheritedRange ?? null : null;
              const rangeDays = selectedDate || dateRange ? initial!.filters.rangeDays : Number(key);
              setFilters((current) => ({ ...current, rangeDays, selectedDate, dateRange }));
            }}
          >
            <Label className="sr-only">{t('share.dateRangeShort')}</Label>
            <Select.Trigger className="!h-8 !min-h-8 !w-fit !items-center !py-0 ps-3 pe-8 !text-xs">
              <Select.Value className="!text-xs !leading-4" />
              <Select.Indicator />
            </Select.Trigger>
            <FilterSelectPopover className="w-44" placement="bottom start">
              <ListBox aria-label={t('share.dateRangeOptions')}>
                {SHARE_RANGE_OPTIONS.map((option) => (
                  <ListBox.Item id={String(option.days)} key={option.days} textValue={shareRangeLabel(option.days, locale)}>
                    {shareRangeLabel(option.days, locale)}<ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
                {inheritedRange && <ListBox.Item id="custom" textValue={inheritedRangeLabel}>
                  {inheritedRangeLabel}<ListBox.ItemIndicator />
                </ListBox.Item>}
                {inheritedDate && (
                  <ListBox.Item id={`date:${inheritedDate}`} textValue={inheritedDate}>
                    {inheritedDate}<ListBox.ItemIndicator />
                  </ListBox.Item>
                )}
              </ListBox>
            </FilterSelectPopover>
          </Select>
          <ToolChannelSelect
            ariaLabel={t('share.agentFilter')}
            tools={sources.map((source) => ({ source }))}
            selectedTools={filters.selectedSources}
            onChange={(selectedSources) => setFilters((current) => ({ ...current, selectedSources }))}
          />
        </div>
        <div className="mx-auto mb-3 grid max-w-xl grid-cols-2 items-end gap-2 px-4 sm:grid-cols-3">
          <Select aria-label={t('island.share.content')} value={presentation.layout} onChange={key => { if (key) setPresentation(current => ({ ...current, layout: String(key) as SharePresentation['layout'] })); }}>
            <Label>{t('island.share.content')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <FilterSelectPopover><ListBox>{['details', 'tokens', 'cost'].map(value => <ListBox.Item key={value} id={value} textValue={t(`island.share.${value}`)}>{t(`island.share.${value}`)}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
          </Select>
          <Select aria-label={t('island.share.aspect')} value={presentation.aspect} onChange={key => { if (key) setPresentation(current => ({ ...current, aspect: String(key) as ShareAspect })); }}>
            <Label>{t('island.share.aspect')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <FilterSelectPopover><ListBox>{['2:3', '1:1', '4:5', '9:16'].map(value => <ListBox.Item key={value} id={value} textValue={value}>{value}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
          </Select>
          <TextField className="col-span-2 sm:col-span-1" value={userName} onChange={setUserName} maxLength={40}>
            <Label>{t('island.share.author')}</Label><Input placeholder={t('share.poster.defaultUser')} />
          </TextField>
        </div>
        <ShareBackgroundPicker library={backgrounds} selectedVariant={currentVariant}
          deletingId={deletingId} onCancelDelete={() => setDeletingId(null)}>
          {(onUpload, onAdjust) => <div className="relative w-full" aria-busy={loading}>
            <ShareCardCarousel activeIndex={currentIndex} selectionRevision={selectionRevision} onActiveIndexChange={selectVariant} variants={variants} disabled={backgrounds.loading || backgrounds.busy}
              presentation={presentation} costEvidence={costEvidence} userName={userName}
              onAddBackground={onUpload} addBackgroundDisabled={!backgrounds.ready || backgrounds.readOnly}
              onAdjustBackground={onAdjust} onDeleteBackground={() => setDeletingId(currentVariant.id)}
              replaceBackground={backgrounds.items.length >= MAX_SHARE_BACKGROUNDS}
              rangeLabel={rangeLabel} reservedHeight={390} summary={preview?.summary ?? null}
              details={preview?.details} toolLabel={preview?.toolLabel} />
            {disabled && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/90 p-6 text-center" role="status" aria-live="polite">
                {loading || cost.loading ? <><Spinner size="sm" /><span className="text-sm text-muted">{t('share.previewLoading')}</span></> : <>
                  <p className="text-sm text-muted">{error ? t('share.previewError') : t('share.previewEmpty')}</p>
                  <Button size="sm" variant="secondary" onPress={retry}>{t('share.retry')}</Button>
                </>}
              </div>
            )}
          </div>}
        </ShareBackgroundPicker>
      </Modal.Body>
      <Modal.Footer className="mt-3 shrink-0 flex-wrap justify-center">
        <ShareCardActions color={currentVariant.color} theme={currentVariant.theme} backgroundImage={currentVariant.backgroundImage} rangeLabel={rangeLabel}
          presentation={presentation} costEvidence={costEvidence} userName={userName}
          onExportSuccess={backgrounds.selectedId ? () => backgrounds.markUsed(currentVariant.id) : undefined}
          summary={preview?.summary ?? null} details={preview?.details} toolLabel={preview?.toolLabel} disabled={disabled || backgrounds.loading || backgrounds.busy} />
        <Button variant="tertiary" isDisabled={disabled} onPress={() => void copyCaption()}>{t('island.share.copyCaption')}</Button>
        {copyState !== 'idle' && <p role="status" className={`w-full text-center text-xs ${copyState === 'failed' ? 'text-danger' : 'text-muted'}`}>{t(copyState === 'failed' ? 'island.share.copyFailed' : 'island.quota.copied')}</p>}
      </Modal.Footer>
    </>
  );
}
