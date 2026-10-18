import type { DoctorReport } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { cliMessages } from './i18n/messages.js';
import { cliT, systemCliLocale } from './i18n/locale.js';

function shouldUseColors(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function c(color: keyof typeof colors, text: string, enabled: boolean): string {
  if (!enabled) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

export function printDoctorReport(report: DoctorReport, locale: SupportedLocale = systemCliLocale()): void {
  const useColor = shouldUseColors();
  const t = (key: string, options?: Record<string, unknown>) => cliT(locale, `doctor.${key}`, options);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const localizedMessage = (key: string, fallback: string, options?: Record<string, unknown>) =>
    cliMessages[locale][`cli.doctor.${key}`] ? t(key, options) : fallback;

  console.log();
  console.log(
    c(
      'bold',
      `🩺 ${c('cyan', 'Quotern Doctor', useColor)} - ${t('title')}`,
      useColor,
    ),
  );
  console.log(c('dim', t('time', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(report.timestamp)) }), useColor));
  console.log();

  for (const cat of report.categories) {
    let catIcon = c('green', '[✓]', useColor);
    if (cat.status === 'error') {
      catIcon = c('red', '[✗]', useColor);
    } else if (cat.status === 'warn') {
      catIcon = c('yellow', '[!]', useColor);
    }

    console.log(`${catIcon} ${c('bold', localizedMessage(`category.${cat.id}`, cat.id), useColor)}`);

    for (const item of cat.items) {
      let itemIcon = c('green', '✓', useColor);
      if (item.status === 'error') itemIcon = c('red', '✗', useColor);
      else if (item.status === 'warn') itemIcon = c('yellow', '!', useColor);
      else if (item.status === 'info') itemIcon = c('gray', '-', useColor);

      const name = localizedMessage(`item.${item.id}`, item.id);
      const message = locale === 'zh-CN' || item.id === 'runtime-os'
        ? item.message
        : localizedMessage(
          `message.${item.id}.${item.status}`,
          t(`message.generic.${item.status}`),
          item.id === 'collectors-summary' ? { count: number(report.collectors.detected) } : undefined,
        );
      console.log(`  ${itemIcon} ${name}: ${message}`);
      if (item.detail && (locale === 'zh-CN' || process.env.QUOTERN_DEBUG === '1')) {
        console.log(`    ${c('dim', item.detail, useColor)}`);
      }
    }
    console.log();
  }

  // Display collectors breakdown if any
  const detected = report.collectors.items.filter((i) => i.present);
  const undetected = report.collectors.items.filter((i) => !i.present);

  console.log(
    c('cyan', `📊 ${t('collectorDetails', { detected: number(detected.length), total: number(report.collectors.total) })}`, useColor),
  );

  if (detected.length > 0) {
    for (const d of detected) {
      const hookText = d.hookStatus ? ` ${c('cyan', `[${t(d.hookStatus === 'active' ? 'hookActive' : 'hookInactive')}]`, useColor)}` : '';
      console.log(`  ${c('green', '✓', useColor)} ${d.displayName}${hookText}`);
    }
  } else {
    console.log(`  ${c('yellow', '!', useColor)} ${t('noneDetected')}`);
  }

  if (undetected.length > 0) {
    const unNames = undetected.map((u) => u.displayName).join(', ');
    console.log(
      `  ${c('dim', `- ${t('undetected', { count: number(undetected.length), names: unNames })}`, useColor)}`,
    );
  }
  console.log();

  // Suggestions block if any warnings/errors
  const suggestions = locale === 'zh-CN'
    ? report.summary.suggestions
    : [...new Set(report.categories.flatMap((category) => category.items)
      .filter((item) => item.suggestion)
      .map((item) => localizedMessage(`suggestion.${item.id}`, t(`message.generic.${item.status}`))))];
  if (suggestions.length > 0) {
    console.log(c('bold', c('yellow', `💡 ${t('suggestions')}`, useColor), useColor));
    for (const suggestion of suggestions) {
      console.log(`  • ${suggestion}`);
    }
    console.log();
  }

  // Summary conclusion line
  if (report.summary.status === 'ok') {
    console.log(
      c(
        'green',
        t('summary.ok', { ok: number(report.summary.okCount) }),
        useColor,
      ),
    );
  } else if (report.summary.status === 'warn') {
    console.log(
      c(
        'yellow',
        t('summary.warn', { warn: number(report.summary.warnCount) }),
        useColor,
      ),
    );
  } else {
    console.log(
      c(
        'red',
        t('summary.error', { error: number(report.summary.errorCount) }),
        useColor,
      ),
    );
  }
  console.log();
}
