import type { CSSProperties, Ref } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import quoternQrLogoUrl from '../assets/quotern-qr-logo.svg?url&inline';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import { formatTokens, formatUsd } from '../lib/format';
import { SHARE_CARD_FONT_FAMILY, SHARE_CARD_MONO_FONT_FAMILY } from '../lib/share-card-image';
import { sourceLabel } from '../lib/tokens';
import { ProviderIcon } from './ProviderIcon';

export interface SharePosterDetails {
  days: { date: string; tokens: number }[];
  models: { model: string; tokens: number }[];
  sources?: string[];
}

const SERIF = 'Georgia, "Times New Roman", "Noto Serif CJK SC", serif';

// Themes own colors only; both preview and export use the same content/layout.
const SHARE_POSTER_PALETTES = {
  neon: {
    background: 'radial-gradient(ellipse at 0% 40%, #80296b80, transparent 55%), radial-gradient(ellipse at 100% 85%, #323edca0, transparent 60%), #100b35',
    foreground: '#f4edff',
    border: '#8060bb50',
    rule: '#b196e638',
    metricBackground: '#110d3c99',
    muted: '#c2addf',
    cost: '#11ee8c',
    rankAccent: '#e694ff',
  },
  editorial: {
    background: '#f8f5ee',
    foreground: '#211e19',
    border: '#e4dfd5',
    rule: '#cbc5b9',
    metricBackground: '#eee9df70',
    muted: '#635b50',
    cost: '#087a49',
    rankAccent: '#c93238',
  },
  custom: {
    background: '#100b35', foreground: '#ffffff', border: '#ffffff40', rule: '#ffffff40',
    metricBackground: '#08091699', muted: '#e2e8f0', cost: '#4ade80', rankAccent: '#d8b4fe',
  },
} as const;
export type ShareCardTheme = keyof typeof SHARE_POSTER_PALETTES;

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
  borderRadius = 16, cardRef, theme = 'neon', backgroundImage, details, isHidden, rangeLabel, summary, userName,
}: {
  avatarUrl?: string;
  borderRadius?: number;
  cardRef?: Ref<HTMLElement>;
  theme?: ShareCardTheme;
  backgroundImage?: string;
  details?: SharePosterDetails;
  isHidden?: boolean;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const palette = SHARE_POSTER_PALETTES[theme];
  const displayName = userName?.trim() || 'Quotern 用户';
  const agentSources = [...new Map((details?.sources ?? []).map((source) => [sourceLabel(source), source])).values()];
  const extraAgents = agentSources.slice(4);
  const agentBadge: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: 18, height: 18, borderRadius: 4, background: '#fff', color: '#111827',
    border: `1px solid ${palette.rule}`,
  };
  const modelTotals = new Map<string, number>();
  for (const row of details?.models ?? []) modelTotals.set(row.model, (modelTotals.get(row.model) ?? 0) + row.tokens);
  const models = [...modelTotals].filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1]);
  const modelTotal = models.reduce((sum, [, tokens]) => sum + tokens, 0);
  const metrics = [
    { label: '预估费用', value: summary ? formatUsd(summary.totalCostUsd) : '—' },
    { label: '总 Token', value: summary ? formatTokens(summary.totalTokens) : '—' },
    { label: '输入 Token', value: summary ? formatTokens(summary.inputTokens) : '—' },
    { label: '输出 Token', value: summary ? formatTokens(summary.outputTokens) : '—' },
  ];
  const surface: CSSProperties = {
    position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    overflow: 'hidden', padding: 20, boxSizing: 'border-box', borderRadius,
    color: palette.foreground, fontFamily: SHARE_CARD_FONT_FAMILY,
    background: palette.background,
    border: `1px solid ${palette.border}`,
    isolation: 'isolate',
  };
  const rule = palette.rule;
  return (
    <article ref={cardRef} aria-hidden={isHidden || undefined} style={surface}>
      {backgroundImage && <>
        <img alt="" data-share-background src={backgroundImage} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: -2 }} />
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(8, 9, 22, 0.64)', zIndex: -1 }} />
      </>}
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10, borderBottom: `1px solid ${rule}` }}>
        <img alt="" src={quoternQrLogoUrl} style={{ width: 22, height: 22 }} />
        <div style={{ flex: 1 }}><div style={{ fontSize: 9, letterSpacing: 2 }}>QUOTERN</div><div style={{ fontSize: 15, fontWeight: 700 }}>Agent 用量报告</div></div>
      </header>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 9 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ whiteSpace: 'nowrap' }}>{rangeLabel || '全部时间'}</span>
          {agentSources.length > 0 && (
            <div role="group" aria-label="统计范围内的 Agent" style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              {agentSources.slice(0, 4).map((source) => (
                <span key={sourceLabel(source)} role="img" aria-label={sourceLabel(source)} title={sourceLabel(source)} style={agentBadge}>
                  <ProviderIcon provider={source} size={14} onLightBackground color="#111827" />
                </span>
              ))}
              {extraAgents.length > 0 && (
                <span role="img" aria-label={`其他 ${extraAgents.length} 个 Agent：${extraAgents.map(sourceLabel).join('、')}`} title={extraAgents.map(sourceLabel).join('、')} style={{ ...agentBadge, fontSize: 8, fontFamily: SHARE_CARD_MONO_FONT_FAMILY }}>
                  +{extraAgents.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <dl aria-label="用量汇总" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, margin: '12px 0 0' }}>
        {metrics.map((metric, index) => {
          const valueColor = index === 0 ? palette.cost : palette.foreground;
          return (
            <div key={metric.label} style={{ position: 'relative', isolation: 'isolate', overflow: 'hidden', minWidth: 0, padding: 8, border: `1px solid ${rule}`, borderRadius: 10, background: palette.metricBackground }}>
              <MetricSparklineBackground color={valueColor} index={index} />
              <dt style={{ position: 'relative', zIndex: 1, fontSize: 10, lineHeight: 1.4, color: palette.muted }}>{metric.label}</dt>
              <dd style={{ position: 'relative', zIndex: 1, margin: '6px 0 0', fontFamily: SHARE_CARD_MONO_FONT_FAMILY, fontSize: 18, lineHeight: 4 / 3, fontWeight: 700, color: valueColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.value}</dd>
            </div>
          );
        })}
      </dl>
      <section style={{ marginTop: 24 }} aria-label="模型用量排行">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, paddingBottom: 6, borderBottom: `1px solid ${rule}` }}><span>模型榜单</span><span>TOP 03</span></div>
        {models.slice(0, 3).map(([model, tokens], index) => (
          <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', borderBottom: `1px solid ${rule}`, fontSize: 10, lineHeight: 1.5 }}>
            <span style={{ color: palette.rankAccent, fontFamily: SERIF, fontStyle: 'italic' }}>{String(index + 1).padStart(2, '0')}</span>
            <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{model}</span>
            <span style={{ fontFamily: SHARE_CARD_MONO_FONT_FAMILY }}>{formatTokens(tokens)}</span>
            <span style={{ fontSize: 8, opacity: 0.75 }}>{Math.round(tokens / modelTotal * 100)}%</span>
          </div>
        ))}
        {!models.length && <p style={{ fontSize: 10, opacity: 0.75 }}>暂无模型用量数据</p>}
      </section>
      <footer style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 9, lineHeight: 1.7, opacity: 0.9, whiteSpace: 'nowrap' }}>记录你的创造</div>
        <QRCodeSVG bgColor={backgroundImage ? '#ffffff' : 'transparent'} fgColor={backgroundImage ? '#111827' : palette.foreground} marginSize={backgroundImage ? 4 : 2} size={backgroundImage ? 36 : 32} level="M" title="查看 Quotern 项目" value="https://github.com/yuhengqin/Quotern" />
      </footer>
    </article>
  );
}
