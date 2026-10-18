import { useEffect, useRef, useState } from 'react';
import { Headset } from 'lucide-react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { cn } from '@/lib/utils';

const WECHAT_QR_SRC = `${import.meta.env.BASE_URL}captain-wechat.jpg`;

function canHoverOpen(): boolean {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function SupportQrCard() {
  const { t } = useTranslation();
  return (
    <div className="w-52 rounded-xl bg-overlay p-3 text-overlay-foreground shadow-surface">
      <p className="text-sm font-medium text-foreground">{t('about.feedbackTitle')}</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        {t('about.supportDescription')}
      </p>
      <img
        alt={t('about.supportQrAlt')}
        className="mt-2.5 block h-auto w-full rounded-lg bg-white"
        decoding="async"
        draggable={false}
        height={640}
        src={WECHAT_QR_SRC}
        width={480}
      />
    </div>
  );
}

/** Hover on desktop, press/click on mobile, to reveal the support QR. */
export function WeChatSupportTrigger({
  variant,
}: {
  variant: 'chrome' | 'link';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isLink = variant === 'link';

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        if (canHoverOpen()) setOpen(true);
      }}
      onMouseLeave={() => {
        if (canHoverOpen()) setOpen(false);
      }}
    >
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('about.feedbackTitle')}
        className={
          isLink
            ? cn(
                'h-7 min-h-7 min-w-7 shrink-0 p-0 text-foreground/70 shadow-none',
                'hover:bg-transparent hover:text-foreground',
                'data-[pressed=true]:bg-transparent',
              )
            : 'size-8 min-h-8 min-w-8 shrink-0 p-0'
        }
        isIconOnly
        size="sm"
        variant={isLink ? 'ghost' : 'tertiary'}
        onPress={() => setOpen((value) => !value)}
      >
        <Headset
          aria-hidden="true"
          className={isLink ? 'size-4.5' : 'size-4'}
          strokeWidth={2}
        />
      </Button>
      {open ? (
        <div
          className={cn(
            'absolute z-50',
            isLink
              ? 'bottom-full left-1/2 -translate-x-1/2 pb-2'
              : 'top-full right-0 pt-2',
          )}
          role="dialog"
          aria-label={t('about.feedbackTitle')}
        >
          <SupportQrCard />
        </div>
      ) : null}
    </div>
  );
}
