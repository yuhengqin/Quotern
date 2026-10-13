import { Avatar, Button } from '@heroui/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  type CSSProperties,
  type Ref,
  type TransitionEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import quoternQrLogoUrl from '../assets/quotern-qr-logo.svg?url&inline';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import { formatTokens, formatUsd } from '../lib/format';
const QUOTERN_PROJECT_URL = 'https://github.com/yuhengqin/Quotern';
import {
  SHARE_CARD_FONT_FAMILY,
  SHARE_CARD_MONO_FONT_FAMILY,
} from '../lib/share-card-image';

export const SHARE_CARD_COLORS = ['#141b1A', '#087FFA'] as const;

type SlideDirection = -1 | 1;

interface CardTransition {
  direction: SlideDirection;
  fromIndex: number;
  phase: 'prepare' | 'running';
  toIndex: number;
}

const CARD_TRANSITION_CLASS =
  'transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';

function getCardSurfaceStyle(color: string): CSSProperties {
  return {
    backgroundColor: color,
  };
}

function getPreviewPosition(relativeIndex: number, total: number) {
  if (total === 2) {
    return relativeIndex === 0
      ? { offset: 0, rotation: 0, opacity: 0, zIndex: 0 }
      : { offset: 38, rotation: 3, opacity: 0.88, zIndex: 1 };
  }

  const sideCardCount = Math.max(0, total - 1);
  if (relativeIndex >= sideCardCount) {
    return { offset: 0, rotation: 0, opacity: 0.55, zIndex: 0 };
  }

  const leftCardCount = Math.ceil(sideCardCount / 2);
  const isLeft = relativeIndex < leftCardCount;
  const distance = isLeft
    ? leftCardCount - relativeIndex
    : relativeIndex - leftCardCount + 1;

  return {
    offset: (isLeft ? -1 : 1) * 38 * distance,
    rotation: (isLeft ? -1 : 1) * 3 * distance,
    opacity: Math.max(0.5, 0.88 - 0.16 * (distance - 1)),
    zIndex: Math.max(1, leftCardCount - distance + 1),
  };
}

function ShareQrCode() {
  return (
    <QRCodeSVG
      bgColor="transparent"
      className="ml-auto size-12 shrink-0 self-center overflow-hidden rounded-[6px]"
      fgColor="#fff"
      imageSettings={{
        excavate: true,
        height: 12,
        src: quoternQrLogoUrl,
        width: 12,
      }}
      level="H"
      marginSize={4}
      size={48}
      title="查看 Quotern 项目"
      value={QUOTERN_PROJECT_URL}
    />
  );
}

const METRIC_SPARKLINE_PATHS = [
  'M0 42 C16 40 20 23 36 27 S58 38 72 20 S98 9 120 14',
  'M0 36 C14 29 24 34 38 23 S61 14 76 22 S101 15 120 7',
  'M0 39 C12 34 26 36 40 30 S61 9 76 17 S99 31 120 18',
  'M0 43 C17 42 23 25 39 29 S62 37 78 23 S105 19 120 8',
] as const;

function MetricSparklineBackground({
  color,
  index,
}: {
  color: string;
  index: number;
}) {
  const path = METRIC_SPARKLINE_PATHS[index] ?? METRIC_SPARKLINE_PATHS[0];

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-11 w-full"
      preserveAspectRatio="none"
      viewBox="0 0 120 52"
    >
      <path
        d={`${path} L120 52 L0 52 Z`}
        fill={color}
        fillOpacity="0.06"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeOpacity="0.22"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function getCardTransform(offset = 0, rotation = 0, scale = 1) {
  return `translate(calc(-50% + ${offset}px), -50%) rotate(${rotation}deg) scale(${scale})`;
}

function shouldReduceMotion() {
  return document.querySelector('[data-reduce-motion="true"]') !== null
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ShareCardArtwork({
  avatarUrl,
  borderRadius = 30,
  cardRef,
  color,
  isHidden,
  rangeLabel,
  summary,
  toolLabel,
  userName,
}: {
  avatarUrl?: string;
  borderRadius?: number;
  cardRef?: Ref<HTMLElement>;
  color: string;
  isHidden?: boolean;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const isBlackCard = color.toLowerCase() === '#141b1a';
  const displayName = userName?.trim() || 'Quotern 用户';
  const avatarInitial = displayName.slice(0, 1).toUpperCase();
  const filterLabel = `${rangeLabel || '全部时间'} · ${toolLabel || '全部工具'}`;
  const metrics = [
    { label: '预估费用', value: summary ? formatUsd(summary.totalCostUsd) : '—' },
    { label: '总 Token', value: summary ? formatTokens(summary.totalTokens) : '—' },
    { label: '输入 Token', value: summary ? formatTokens(summary.inputTokens) : '—' },
    { label: '输出 Token', value: summary ? formatTokens(summary.outputTokens) : '—' },
  ] as const;

  return (
    <article
      aria-hidden={isHidden || undefined}
      className="relative grid h-full w-full grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden text-white"
      ref={cardRef}
      style={{
        ...getCardSurfaceStyle(color),
        borderRadius: `${borderRadius}px`,
        fontFamily: SHARE_CARD_FONT_FAMILY,
      }}
    >
      <div className="absolute left-5 top-4 flex items-center gap-1 text-[13px] font-normal leading-none text-white">
        <img alt="" className="size-5.5" src={quoternQrLogoUrl} />
        <div className="text-[13px]">Quotern</div>
      </div>

      <div className="flex min-h-0 items-center justify-center px-4 pt-8">
        <h2 className="text-3xl font-medium tracking-tight">AI 用量</h2>
      </div>

      <dl className="grid auto-rows-fr grid-cols-2 gap-2 px-4 font-sans font-normal">
        {metrics.map((metric, index) => {
          const valueColor = isBlackCard && index === 0 ? '#11EE8C' : '#fff';

          return (
            <div
              className="relative isolate flex min-h-16 min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-white/10 bg-white/[0.07] p-3"
              key={metric.label}
            >
              <MetricSparklineBackground color={valueColor} index={index} />
              <dt className="relative z-10 truncate text-[11px] font-normal text-white/60">
                {metric.label}
              </dt>
              <dd
                className="relative z-10 mt-2 truncate text-base font-medium tracking-tight tabular-nums"
                style={{
                  color: valueColor,
                  fontFamily: SHARE_CARD_MONO_FONT_FAMILY,
                }}
              >
                {metric.value}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="flex max-w-full items-center gap-2.5 px-4 pb-4 pt-4">
        <Avatar
          className="aspect-square size-9 shrink-0 overflow-hidden rounded-full"
          variant="soft"
        >
          {avatarUrl ? (
            <Avatar.Image
              alt={isHidden ? '' : `${displayName}的头像`}
              className="aspect-square size-full rounded-full object-cover"
              src={avatarUrl}
            />
          ) : null}
          <Avatar.Fallback
            className="aspect-square size-full rounded-full border-none bg-white/15 font-normal text-white/70"
          >
            {avatarInitial}
          </Avatar.Fallback>
        </Avatar>
        <div className="min-w-0 text-left font-normal">
          <p
            className="max-w-40 truncate pb-0.5 text-[11px] leading-4"
            title={displayName}
          >
            @{displayName}
          </p>
          <p
            className="max-w-40 truncate text-[9px] leading-3.5 text-white/55"
            title={filterLabel}
          >
            {filterLabel}
          </p>
        </div>
        <ShareQrCode />
      </div>
    </article>
  );
}

function ShareCard({
  avatarUrl,
  color,
  isHidden,
  onTransitionEnd,
  rangeLabel,
  style,
  summary,
  toolLabel,
  userName,
}: {
  avatarUrl?: string;
  color: string;
  isHidden?: boolean;
  onTransitionEnd?: (event: TransitionEvent<HTMLElement>) => void;
  rangeLabel?: string;
  style: CSSProperties;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  return (
    <div
      aria-hidden={isHidden || undefined}
      className={`absolute left-1/2 top-1/2 h-full aspect-2/3 ${CARD_TRANSITION_CLASS}`}
      onTransitionEnd={onTransitionEnd}
      style={style}
    >
      <ShareCardArtwork
        avatarUrl={avatarUrl}
        color={color}
        isHidden={isHidden}
        rangeLabel={rangeLabel}
        summary={summary}
        toolLabel={toolLabel}
        userName={userName}
      />
    </div>
  );
}

export const SHARE_CARD_VARIANTS = SHARE_CARD_COLORS.map((color) => ({ color }));

export function getShareCardVariant(index: number) {
  const normalizedIndex = (
    (index % SHARE_CARD_VARIANTS.length) + SHARE_CARD_VARIANTS.length
  ) % SHARE_CARD_VARIANTS.length;
  return SHARE_CARD_VARIANTS[normalizedIndex] ?? SHARE_CARD_VARIANTS[0];
}

export function ShareCardCarousel({
  activeIndex,
  avatarUrl,
  onActiveIndexChange,
  rangeLabel,
  summary,
  toolLabel,
  userName,
}: {
  activeIndex: number;
  avatarUrl?: string;
  onActiveIndexChange: (index: number) => void;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const [transition, setTransition] = useState<CardTransition | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentIndex = (
    (activeIndex % SHARE_CARD_VARIANTS.length) + SHARE_CARD_VARIANTS.length
  ) % SHARE_CARD_VARIANTS.length;

  useEffect(() => {
    if (transition?.phase !== 'prepare') return undefined;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setTransition((current) => (
          current ? { ...current, phase: 'running' } : current
        ));
      });
    });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [transition?.phase]);

  const move = (direction: SlideDirection) => {
    if (transition) return;

    const toIndex = (
      currentIndex + direction + SHARE_CARD_VARIANTS.length
    ) % SHARE_CARD_VARIANTS.length;

    if (shouldReduceMotion()) {
      onActiveIndexChange(toIndex);
      return;
    }

    setTransition({
      direction,
      fromIndex: currentIndex,
      phase: 'prepare',
      toIndex,
    });
  };

  const finishTransition = (event: TransitionEvent<HTMLElement>) => {
    if (event.propertyName !== 'transform' || transition?.phase !== 'running') return;

    onActiveIndexChange(transition.toIndex);
    setTransition(null);
  };

  const stackActiveIndex = transition?.toIndex ?? currentIndex;
  const activeVariant = getShareCardVariant(currentIndex);

  return (
    <section className="flex w-full flex-col items-center gap-5 py-2" aria-label="分享卡片选择">
      <div className="grid w-full max-w-170 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 sm:gap-6">
        <Button
          aria-label="上一张卡片"
          className="z-20 rounded-full"
          isDisabled={transition !== null}
          isIconOnly
          onPress={() => move(-1)}
          variant="tertiary"
        >
          <ChevronLeft className="size-5" />
        </Button>

        <div className="relative aspect-2/3 w-full max-w-75 min-w-0 justify-self-center">
          {SHARE_CARD_VARIANTS.map((variant, cardIndex) => {
            const relativeIndex = (
              cardIndex - stackActiveIndex + SHARE_CARD_VARIANTS.length
            ) % SHARE_CARD_VARIANTS.length;
            const position = getPreviewPosition(
              relativeIndex,
              SHARE_CARD_VARIANTS.length,
            );

            return (
              <div
                aria-hidden="true"
                className={`absolute left-1/2 top-1/2 h-[92%] aspect-2/3 rounded-[28px] ${CARD_TRANSITION_CLASS}`}
                key={variant.color}
                style={{
                  ...getCardSurfaceStyle(variant.color),
                  opacity: position.opacity,
                  transform: getCardTransform(position.offset, position.rotation),
                  zIndex: position.zIndex,
                }}
              />
            );
          })}

          {transition ? (
            <>
              <ShareCard
                avatarUrl={avatarUrl}
                color={getShareCardVariant(transition.fromIndex).color}
                isHidden
                rangeLabel={rangeLabel}
                style={{
                  opacity: transition.phase === 'running' ? 0 : 1,
                  transform: transition.phase === 'running'
                    ? getCardTransform(-transition.direction * 72, -transition.direction * 4, 0.96)
                    : getCardTransform(),
                  zIndex: 20,
                }}
                summary={summary}
                toolLabel={toolLabel}
                userName={userName}
              />
              <ShareCard
                avatarUrl={avatarUrl}
                color={getShareCardVariant(transition.toIndex).color}
                onTransitionEnd={finishTransition}
                rangeLabel={rangeLabel}
                style={{
                  opacity: transition.phase === 'running' ? 1 : 0,
                  transform: transition.phase === 'running'
                    ? getCardTransform()
                    : getCardTransform(transition.direction * 72, transition.direction * 4, 0.96),
                  zIndex: 10,
                }}
                summary={summary}
                toolLabel={toolLabel}
                userName={userName}
              />
            </>
          ) : (
            <ShareCard
              avatarUrl={avatarUrl}
              color={activeVariant.color}
              rangeLabel={rangeLabel}
              style={{
                opacity: 1,
                transform: getCardTransform(),
                zIndex: 10,
              }}
              summary={summary}
              toolLabel={toolLabel}
              userName={userName}
            />
          )}
        </div>

        <Button
          aria-label="下一张卡片"
          className="z-20 rounded-full"
          isDisabled={transition !== null}
          isIconOnly
          onPress={() => move(1)}
          variant="tertiary"
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>
    </section>
  );
}
