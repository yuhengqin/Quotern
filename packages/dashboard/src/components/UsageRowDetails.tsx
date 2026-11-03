import type { ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { formatPct, formatTokens, formatUsd } from '@/lib/format';

export interface UsageModelDetail {
  label: string;
  tokens: number;
  costUsd: number;
  pct: number;
  color: string;
}

/** The full row remains an easy target even when its plotted share is tiny. */
export function UsageRowDetails({ title, tokens, costUsd, models, children }: {
  title: string; tokens: number; costUsd: number; models: UsageModelDetail[]; children: ReactNode;
}) {
  const { t } = useTranslation();
  return <Popover>
    <Button aria-label={t('usage.common.modelDetails', { label: title })} variant="ghost"
      className="block h-auto min-h-14 w-full min-w-0 whitespace-normal rounded-lg px-0 py-0 text-left font-normal data-[hovered]:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent">
      {children}
    </Button>
    <Popover.Content placement="bottom start" maxHeight={448} className="flex w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl bg-overlay p-0 text-overlay-foreground shadow-surface">
      <Popover.Dialog className="min-h-0 overflow-y-auto overscroll-contain p-4 text-xs outline-none">
        <Popover.Heading className="break-all text-sm font-semibold">{title}</Popover.Heading>
        <p className="mt-2 text-muted tabular-nums">{formatTokens(tokens)} Token · {formatUsd(costUsd)}</p>
        <ul className="mt-3 divide-y divide-border">
          {models.map((model, index) => <li key={index} className="space-y-1 py-2">
            <p className="flex items-start gap-2"><span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: model.color }} /><span className="min-w-0 break-all">{model.label}</span></p>
            <p className="pl-4 text-muted tabular-nums">{formatTokens(model.tokens)} Token · {formatUsd(model.costUsd)} · {formatPct(model.pct)}</p>
          </li>)}
        </ul>
        <p className="mt-2 text-muted">{t('usage.common.modelShare')}</p>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
