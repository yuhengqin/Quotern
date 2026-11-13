import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal } from '@heroui/react';
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider';
import { useTranslation } from 'quotern-i18n/react';
import { normalizeLocale } from 'quotern-i18n';
import type { DashboardDistributionMetric, DashboardDistributionRow } from '../lib/dashboard-mock-data';
import { buildModelRibbonGeometry, buildModelTokenShare, type ModelRibbonRow } from '../lib/model-token-share';
import { formatDashboardMetric } from '../lib/dashboard-metric-format';
import { formatTokens, formatUsd } from '../lib/format';
import { DashboardMetricTabs } from './DashboardMetricTabs';
import { DistributionRowList } from './UsageDistributionCard';
import './model-token-share.css';

const METRICS = ['tokens', 'cost'] as const;
interface Geometry { width: number; height: number; rows: ModelRibbonRow[] }

export const ModelTokenShareCard = memo(function ModelTokenShareCard({ rows }: { rows: DashboardDistributionRow[] }) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage);
  const title = t('usage.page.modelDistribution');
  const descriptionId = useId();
  const [metric, setMetric] = useState<DashboardDistributionMetric>('tokens');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [isAllOpen, setIsAllOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const view = useMemo(() => buildModelTokenShare(rows, metric, hiddenIds), [rows, metric, hiddenIds]);
  const { items } = view;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const canvas = body?.querySelector<HTMLElement>('[data-model-share-canvas]');
    if (!body || !canvas || !items.length) return;
    const elements = [...body.querySelectorAll<HTMLElement>('[data-model-share-item]')];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const origin = body.getBoundingClientRect();
      const next: Geometry = {
        width: canvas.getBoundingClientRect().width,
        height: origin.height,
        rows: elements.map(element => {
          const rect = element.getBoundingClientRect();
          return { y: rect.top - origin.top, height: rect.height };
        }),
      };
      setGeometry(previous => previous && previous.width === next.width && previous.height === next.height &&
        previous.rows.length === next.rows.length && previous.rows.every((row, index) =>
          row.y === next.rows[index].y && row.height === next.rows[index].height) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(measure); });
    observer.observe(body);
    observer.observe(canvas);
    elements.forEach(element => observer.observe(element));
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [items]);

  const ribbon = geometry ? buildModelRibbonGeometry(geometry.width, geometry.height, geometry.rows, items.map(item => item.share)) : null;
  const toggleRow = (id: string) => setHiddenIds(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <Card className="model-token-share min-w-0 overflow-hidden rounded-2xl" data-model-token-share>
    <Card.Header className="flex-row flex-nowrap items-start justify-between gap-2 pb-0">
      <div className="min-w-0">
        <Card.Title>{title}</Card.Title>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
          <span>{view.hasHiddenRows ? t('usage.distribution.visibleTotal') : metric === 'tokens' ? 'Tokens' : t('usage.common.estimatedCost')}
            {metric === 'cost' && view.hasUnknownCosts && ` · ${t('usage.explorer.knownSubtotal')}`}</span>
          <strong className="font-medium text-foreground tabular-nums" data-model-share-total>{formatDashboardMetric(metric, metric === 'cost' && view.hasUnknownCosts && !view.hasKnownCosts ? Number.NaN : view.total, locale)}</strong>
        </p>
      </div>
      <DashboardMetricTabs ariaLabel={t('usage.distribution.metricAria', { title })} metrics={METRICS} selectedMetric={metric} onMetricChange={setMetric} />
    </Card.Header>
    <Card.Content className="pt-2">
      {!rows.length ? <p className="py-12 text-center text-sm text-muted">{t('usage.common.noData')}</p> : <>
        <div className="model-share-body" ref={bodyRef}>
          <div className="model-share-canvas" data-model-share-canvas aria-hidden="true">
            {geometry && ribbon && geometry.width > 0 && <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" focusable="false">
              {view.total > 0 && <text x="1" y={Math.max(13, ribbon.sourceY - 7)} className="model-share-source-label">100%</text>}
              {ribbon.bands.map((band, index) => band.thickness > 0 && <g key={items[index].key} fill={items[index].color}
                opacity={activeKey && activeKey !== items[index].key ? 0.18 : 1} data-model-share-band={items[index].key}>
                <path d={band.path} fillOpacity={0.45} />
                <rect x="1" y={band.startY} width="7" height={band.thickness} />
                <rect x={band.endX} y={band.endY} width="3" height={band.thickness} />
              </g>)}
            </svg>}
          </div>
          <ul className="model-share-rows" role="list">
            {items.map((item, index) => {
              const name = item.isOther ? t('usage.modelShare.otherCount', { count: item.count }) : item.label;
              const itemDescription = `${descriptionId}-${index}`;
              return <li key={item.key} data-model-share-item={item.key}>
                <button type="button" className="model-share-row" data-hidden={item.hidden || undefined}
                  aria-label={item.isOther ? t('usage.modelShare.viewOther', { count: item.count }) : t(item.hidden ? 'usage.distribution.show' : 'usage.distribution.hide', { label: item.label })}
                  aria-describedby={`${itemDescription}-share ${itemDescription}-metrics`}
                  aria-pressed={item.isOther ? undefined : !item.hidden}
                  onClick={() => item.isOther ? setIsAllOpen(true) : toggleRow(item.id)}
                  onMouseEnter={() => setActiveKey(item.key)} onMouseLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(item.key)} onBlur={() => setActiveKey(null)}>
                  <span className="model-share-topline">
                    <span className="model-share-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                    <span className="model-share-name">{name}</span>
                    <span id={`${itemDescription}-share`} className="model-share-percentage tabular-nums">{item.hidden || (metric === 'cost' && !Number.isFinite(item.costUsd)) ? '—' : `${item.share.toFixed(1)}%`}</span>
                  </span>
                  <span id={`${itemDescription}-metrics`} className="model-share-meta tabular-nums">
                    <span>{formatTokens(item.tokens)} Token</span><span aria-hidden="true">·</span>
                    <span>{t('usage.distribution.estimatedCost', { amount: formatUsd(item.costUsd) })}</span>
                  </span>
                  <span className="model-share-mini-bar" aria-hidden="true"><span style={{ width: `${item.share}%`, backgroundColor: item.color }} /></span>
                </button>
              </li>;
            })}
          </ul>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2">
          {view.hasHiddenRows && <Button size="sm" variant="ghost" className="h-7 text-xs" onPress={() => setHiddenIds(new Set())}>{t('usage.distribution.restoreAll')}</Button>}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onPress={() => setIsAllOpen(true)}>{t('usage.common.viewAllCount', { count: rows.length })}</Button>
        </div>
      </>}
    </Card.Content>
    <Modal isOpen={isAllOpen} onOpenChange={setIsAllOpen}>
      <Modal.Backdrop><Modal.Container size="md"><div className="contents" ref={portalRef}><Modal.Dialog>
        <Modal.CloseTrigger aria-label={t('usage.common.close')} />
        <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
        <Modal.Body>
          <UNSAFE_PortalProvider getContainer={() => portalRef.current}>
            <div className="max-h-[60vh] overflow-y-auto">
              <DistributionRowList showDetails unknownSharesAsDash metric={metric} rows={view.chartRows} hiddenIds={hiddenIds} visibleTotal={view.total} onToggle={toggleRow} />
            </div>
          </UNSAFE_PortalProvider>
        </Modal.Body>
      </Modal.Dialog></div></Modal.Container></Modal.Backdrop>
    </Modal>
  </Card>;
});
