import { Button, Tooltip } from '@heroui/react';
import { ChevronLeft, ChevronRight, Crop, ImagePlus, Trash2 } from 'lucide-react';
import {
  type CSSProperties,
  type TransitionEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import { ShareCardArtwork, type SharePosterDetails, type ShareCardTheme } from './SharePosterArtwork';
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

function getCardSurfaceStyle(color: string, backgroundImage?: string): CSSProperties {
  return {
    backgroundColor: color,
    backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
    backgroundSize: 'cover', backgroundPosition: 'center',
  };
}

function getPreviewPosition(relativeIndex: number) {
  if (relativeIndex === 0) return { offset: 0, rotation: 0, opacity: 0, zIndex: 0 };
  const distance = Math.abs(relativeIndex);
  return {
    offset: relativeIndex * 38,
    rotation: relativeIndex * 3,
    opacity: Math.max(0.5, 0.88 - 0.16 * (distance - 1)),
    zIndex: Math.max(1, 5 - distance),
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
  theme,
  backgroundImage,
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
  theme: ShareCardTheme;
  backgroundImage?: string;
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
      <div style={{ width: SHARE_CARD_DESIGN_WIDTH, height: SHARE_CARD_DESIGN_HEIGHT, borderRadius: 16, overflow: 'hidden', backgroundColor: color, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <ShareCardArtwork
        avatarUrl={avatarUrl}
        details={details}
        theme={theme}
        backgroundImage={backgroundImage}
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

export interface ShareCardVariant {
  id: string;
  color: string;
  label: string;
  theme: ShareCardTheme;
  backgroundImage?: string;
}
export const SHARE_CARD_VARIANTS: ShareCardVariant[] = SHARE_CARD_COLORS.map((color, index) => ({ id: index === 0 ? 'neon' : 'editorial', color, label: index === 0 ? '霓虹' : '特刊', theme: index === 0 ? 'neon' : 'editorial' }));

export function getShareCardVariant(index: number, variants = SHARE_CARD_VARIANTS) {
  const normalizedIndex = Math.max(0, Math.min(index, variants.length - 1));
  return variants[normalizedIndex] ?? SHARE_CARD_VARIANTS[0];
}

export function ShareCardCarousel({
  variants = SHARE_CARD_VARIANTS,
  disabled = false,
  selectionRevision = 0,
  reservedHeight = 128,
  activeIndex,
  avatarUrl,
  details,
  onActiveIndexChange,
  onAddBackground,
  onAdjustBackground,
  onDeleteBackground,
  addBackgroundDisabled = false,
  replaceBackground = false,
  rangeLabel,
  summary,
  toolLabel,
  userName,
}: {
  variants?: ShareCardVariant[];
  disabled?: boolean;
  selectionRevision?: number;
  reservedHeight?: number;
  activeIndex: number;
  avatarUrl?: string;
  details?: SharePosterDetails;
  onActiveIndexChange: (index: number) => void;
  onAddBackground?: () => void;
  onAdjustBackground?: () => void;
  onDeleteBackground?: () => void;
  addBackgroundDisabled?: boolean;
  replaceBackground?: boolean;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const [transition, setTransition] = useState<CardTransition | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const variantIds = variants.map(({ id }) => id).join(',');
  useEffect(() => { setTransition(null); }, [variantIds, activeIndex, selectionRevision]);
  const currentIndex = Math.max(0, Math.min(activeIndex, variants.length - 1));

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
    if (transition || disabled) return;

    const toIndex = currentIndex + direction;
    if (toIndex < 0 || toIndex >= variants.length) return;

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
  const activeVariant = getShareCardVariant(currentIndex, variants);

  return (
    <section className="flex w-full flex-col items-center gap-3 overflow-x-clip py-2" aria-label="分享卡片选择">
      <div className="grid w-full max-w-170 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 sm:gap-6">
        <Button
          aria-label="上一张卡片"
          className="z-20 justify-self-center rounded-full"
          isDisabled={disabled || transition !== null || currentIndex === 0}
          isIconOnly
          onPress={() => move(-1)}
          variant="tertiary"
        >
          <ChevronLeft className="size-5" />
        </Button>

        <div
          className="group/preview relative aspect-2/3 w-full min-w-0 justify-self-center"
          // Reserve vertical space for dialog controls and export actions.
          style={{ maxWidth: `min(360px, calc((90dvh - ${reservedHeight}px) * 2 / 3))` }}
        >
          {variants.map((variant, cardIndex) => {
            const position = getPreviewPosition(cardIndex - stackActiveIndex);

            return (
              <div
                aria-hidden="true"
                className={`absolute left-1/2 top-1/2 h-[92%] aspect-2/3 rounded-[28px] ${CARD_TRANSITION_CLASS}`}
                key={variant.id}
                style={{
                  ...getCardSurfaceStyle(variant.color, variant.backgroundImage),
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
                color={getShareCardVariant(transition.fromIndex, variants).color}
                theme={getShareCardVariant(transition.fromIndex, variants).theme}
                backgroundImage={getShareCardVariant(transition.fromIndex, variants).backgroundImage}
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
                color={getShareCardVariant(transition.toIndex, variants).color}
                theme={getShareCardVariant(transition.toIndex, variants).theme}
                backgroundImage={getShareCardVariant(transition.toIndex, variants).backgroundImage}
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
              theme={activeVariant.theme}
              backgroundImage={activeVariant.backgroundImage}
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
          {activeVariant.theme === 'custom' && !transition && (
            <div className="absolute right-2 top-2 z-30 flex gap-1 transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/preview:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within/preview:opacity-100">
              {onAdjustBackground && <button type="button" aria-label="调整背景图片" title="调整背景图片" disabled={disabled} onClick={onAdjustBackground}
                className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-sm backdrop-blur-sm hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 [@media(hover:hover)_and_(pointer:fine)]:size-8">
                <Crop aria-hidden="true" className="size-4" />
              </button>}
              {onDeleteBackground && <button type="button" aria-label="删除这张背景" title="删除这张背景" disabled={disabled} onClick={onDeleteBackground}
                className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-sm backdrop-blur-sm hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 [@media(hover:hover)_and_(pointer:fine)]:size-8">
                <Trash2 aria-hidden="true" className="size-4" />
              </button>}
            </div>
          )}
        </div>

        {currentIndex === variants.length - 1 && onAddBackground ? (
          <Tooltip delay={100} closeDelay={80}>
            <Button aria-label={replaceBackground ? '更换背景' : '添加背景'} variant="tertiary" isIconOnly
              className="z-20 justify-self-center rounded-full"
              isDisabled={disabled || addBackgroundDisabled || transition !== null} onPress={onAddBackground}>
              <ImagePlus aria-hidden="true" className="size-5" />
            </Button>
            <Tooltip.Content placement="top"><p>{replaceBackground ? '更换背景' : '添加背景'}</p></Tooltip.Content>
          </Tooltip>
        ) : <Button
          aria-label="下一张卡片"
          className="z-20 justify-self-center rounded-full"
          isDisabled={disabled || transition !== null || currentIndex === variants.length - 1}
          isIconOnly
          onPress={() => move(1)}
          variant="tertiary"
        >
          <ChevronRight className="size-5" />
        </Button>}
      </div>
    </section>
  );
}
