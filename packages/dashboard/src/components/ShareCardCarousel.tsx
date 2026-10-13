import { Button } from '@heroui/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type CSSProperties,
  type TransitionEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import { ShareCardArtwork, type SharePosterDetails } from './SharePosterArtwork';
import { SHARE_CARD_DESIGN_WIDTH, SHARE_CARD_DESIGN_HEIGHT } from '../lib/share-card-image';

export const SHARE_CARD_COLORS = ['#100b35', '#f8f5ee'] as const;

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

function getCardTransform(offset = 0, rotation = 0, scale = 1) {
  return `translate(calc(-50% + ${offset}px), -50%) rotate(${rotation}deg) scale(${scale})`;
}

function shouldReduceMotion() {
  return document.querySelector('[data-reduce-motion="true"]') !== null
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { ShareCardArtwork } from './SharePosterArtwork';

function ShareCard({
  avatarUrl,
  color,
  details,
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
  details?: SharePosterDetails;
  isHidden?: boolean;
  onTransitionEnd?: (event: TransitionEvent<HTMLElement>) => void;
  rangeLabel?: string;
  style: CSSProperties;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const resize = () => setScale(Number.parseFloat(getComputedStyle(node).width) / SHARE_CARD_DESIGN_WIDTH);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={previewRef}
      aria-hidden={isHidden || undefined}
      className={`absolute left-1/2 top-1/2 h-full w-full ${CARD_TRANSITION_CLASS}`}
      onTransitionEnd={onTransitionEnd}
      style={style}
    >
      <div style={{ width: SHARE_CARD_DESIGN_WIDTH, height: SHARE_CARD_DESIGN_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <ShareCardArtwork
        avatarUrl={avatarUrl}
        details={details}
        color={color}
        isHidden={isHidden}
        rangeLabel={rangeLabel}
        summary={summary}
        toolLabel={toolLabel}
        userName={userName}
      />
      </div>
    </div>
  );
}

export const SHARE_CARD_VARIANTS = SHARE_CARD_COLORS.map((color, index) => ({ color, label: index === 0 ? '霓虹' : '特刊' }));

export function getShareCardVariant(index: number) {
  const normalizedIndex = (
    (index % SHARE_CARD_VARIANTS.length) + SHARE_CARD_VARIANTS.length
  ) % SHARE_CARD_VARIANTS.length;
  return SHARE_CARD_VARIANTS[normalizedIndex] ?? SHARE_CARD_VARIANTS[0];
}

export function ShareCardCarousel({
  activeIndex,
  avatarUrl,
  details,
  onActiveIndexChange,
  rangeLabel,
  summary,
  toolLabel,
  userName,
}: {
  activeIndex: number;
  avatarUrl?: string;
  details?: SharePosterDetails;
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

        <div
          className="relative aspect-2/3 w-full min-w-0 justify-self-center"
          // Reserve vertical space for dialog padding and the export actions.
          style={{ maxWidth: 'min(360px, calc((90dvh - 128px) * 2 / 3))' }}
        >
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
                details={details}
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
                details={details}
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
              details={details}
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
