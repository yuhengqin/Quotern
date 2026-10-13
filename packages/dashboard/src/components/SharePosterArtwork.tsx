import type { CSSProperties, Ref } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import quoternQrLogoUrl from '../assets/quotern-qr-logo.svg?url&inline';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import { formatTokens, formatUsd } from '../lib/format';
import { SHARE_CARD_FONT_FAMILY, SHARE_CARD_MONO_FONT_FAMILY } from '../lib/share-card-image';

export interface SharePosterDetails {
  days: { date: string; tokens: number }[];
  models: { model: string; tokens: number }[];
}

const SERIF = 'Georgia, "Times New Roman", "Noto Serif CJK SC", serif';

const METRIC_SPARKLINE_PATHS = [
  'M0 42 C16 40 20 23 36 27 S58 38 72 20 S98 9 120 14',
  'M0 36 C14 29 24 34 38 23 S61 14 76 22 S101 15 120 7',
  'M0 39 C12 34 26 36 40 30 S61 9 76 17 S99 31 120 18',
  'M0 43 C17 42 23 25 39 29 S62 37 78 23 S105 19 120 8',
] as const;

/** Decorative background curves retained from the original share cards. */
function MetricSparklineBackground({ color, index }: { color: string; index: number }) {
  const path = METRIC_SPARKLINE_PATHS[index] ?? METRIC_SPARKLINE_PATHS[0];
  return (
    <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 120 52" style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 44, pointerEvents: 'none' }}>
      <path d={`${path} L120 52 L0 52 Z`} fill={color} fillOpacity="0.06" />
      <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeOpacity="0.22" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ShareCardArtwork({
  borderRadius = 16, cardRef, color, details, isHidden, rangeLabel, summary, toolLabel, userName,
}: {
  avatarUrl?: string;
  borderRadius?: number;
  cardRef?: Ref<HTMLElement>;
  color: string;
  details?: SharePosterDetails;
  isHidden?: boolean;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const editorial = color.toLowerCase() === '#f8f5ee';
  const displayName = userName?.trim() || 'Quotern 用户';
  const modelTotals = new Map<string, number>();
  for (const row of details?.models ?? []) modelTotals.set(row.model, (modelTotals.get(row.model) ?? 0) + row.tokens);
  const models = [...modelTotals].filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1]);
  const modelTotal = models.reduce((sum, [, tokens]) => sum + tokens, 0);
  const top = models[0];
  const total = summary ? summary.totalTokens.toLocaleString('en-US') : '—';
  const metrics = [
    { label: '预估费用', value: summary ? formatUsd(summary.totalCostUsd) : '—' },
    { label: '总 Token', value: summary ? formatTokens(summary.totalTokens) : '—' },
    { label: '输入 Token', value: summary ? formatTokens(summary.inputTokens) : '—' },
    { label: '输出 Token', value: summary ? formatTokens(summary.outputTokens) : '—' },
  ];
  const surface: CSSProperties = {
    position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    overflow: 'hidden', padding: 20, boxSizing: 'border-box', borderRadius,
    color: editorial ? '#211e19' : '#f4edff', fontFamily: SHARE_CARD_FONT_FAMILY,
    background: editorial ? color : 'radial-gradient(ellipse at 0% 40%, #80296b80, transparent 55%), radial-gradient(ellipse at 100% 85%, #323edca0, transparent 60%), #100b35',
    border: `1px solid ${editorial ? '#e4dfd5' : '#8060bb50'}`,
  };
  const rule = editorial ? '#cbc5b9' : '#b196e638';
  return (
    <article ref={cardRef} aria-hidden={isHidden || undefined} style={surface}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10, borderBottom: `1px solid ${rule}` }}>
        {editorial ? <span style={{ color: '#db393e', fontSize: 10 }}>●</span> : <img alt="" src={quoternQrLogoUrl} style={{ width: 22, height: 22 }} />}
        <div style={{ flex: 1 }}><div style={{ fontSize: 8, letterSpacing: 2 }}>QUOTERN</div>{!editorial && <div style={{ fontSize: 14, fontWeight: 700 }}>用量报告</div>}</div>
        {editorial && <span style={{ fontSize: 7, letterSpacing: 1 }}>用量特刊</span>}
      </header>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 8 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        <span style={{ maxWidth: '60%', textAlign: 'right' }}>{rangeLabel || '全部时间'} · {toolLabel || '全部工具'}</span>
      </div>
      {editorial && (
        <>
          <div style={{ marginTop: 12, fontSize: 7, letterSpacing: 2, color: '#c93238' }}>总 TOKEN 数</div>
          <div style={{ marginTop: 3, fontFamily: SERIF, fontSize: total.length > 11 ? 28 : 32, lineHeight: 1.1, letterSpacing: -1.5 }}>{total}</div>
          <div style={{ marginTop: 4, fontFamily: SERIF, fontSize: 10, fontStyle: 'italic' }}>{top ? `“${top[0]} 占了 ${Math.round(top[1] / modelTotal * 100)}% 的用量。”` : '每一次对话，都留下创造的痕迹。'}</div>
        </>
      )}
      <dl aria-label="用量汇总" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, margin: '12px 0 0' }}>
        {metrics.map((metric, index) => {
          const valueColor = index === 0 ? (editorial ? '#087a49' : '#11ee8c') : (editorial ? '#211e19' : '#f4edff');
          return (
            <div key={metric.label} style={{ position: 'relative', isolation: 'isolate', overflow: 'hidden', minWidth: 0, padding: 8, border: `1px solid ${rule}`, borderRadius: editorial ? 2 : 10, background: editorial ? '#eee9df70' : '#110d3c99' }}>
              <MetricSparklineBackground color={valueColor} index={index} />
              <dt style={{ position: 'relative', zIndex: 1, fontSize: 9, lineHeight: '12px', color: editorial ? '#635b50' : '#c2addf' }}>{metric.label}</dt>
              <dd style={{ position: 'relative', zIndex: 1, margin: '6px 0 0', fontFamily: SHARE_CARD_MONO_FONT_FAMILY, fontSize: 16, lineHeight: '20px', fontWeight: 700, color: valueColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.value}</dd>
            </div>
          );
        })}
      </dl>
      <section style={{ marginTop: 12 }} aria-label="模型用量排行">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, paddingBottom: 6, borderBottom: `1px solid ${rule}` }}><span>模型榜单</span><span>TOP 03</span></div>
        {models.slice(0, 3).map(([model, tokens], index) => (
          <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 0', borderBottom: `1px solid ${rule}`, fontSize: 9 }}>
            <span style={{ color: editorial ? '#c93238' : '#e694ff', fontFamily: SERIF, fontStyle: 'italic' }}>{String(index + 1).padStart(2, '0')}</span>
            <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{model}</span>
            <span style={{ fontFamily: SHARE_CARD_MONO_FONT_FAMILY }}>{formatTokens(tokens)}</span>
            <span style={{ fontSize: 7, opacity: 0.75 }}>{Math.round(tokens / modelTotal * 100)}%</span>
          </div>
        ))}
        {!models.length && <p style={{ fontSize: 10, opacity: 0.75 }}>暂无模型用量数据</p>}
      </section>
      <footer style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 7, lineHeight: 1.7, opacity: 0.85 }}>QUOTERN · AI 用量档案<br />本地生成 · 记录你的创造</div>
        <QRCodeSVG bgColor="transparent" fgColor={editorial ? '#211e19' : '#f4edff'} marginSize={2} size={32} level="M" title="查看 Quotern 项目" value="https://github.com/yuhengqin/Quotern" />
      </footer>
    </article>
  );
}
