import { MoonIcon, SunIcon, SunMoonIcon } from 'lucide-react';
import { Button, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { ThemeMode } from '@/lib/theme';
import { useTheme } from '@/hooks/useTheme';

/** Icon component per mode; rendered lazily so only the active one mounts. */
const MODE_ICON: Record<ThemeMode, typeof SunMoonIcon> = {
  system: SunMoonIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/**
 * Single button that cycles the theme mode system → light → dark → system.
 * The icon and tooltip always show the currently active mode.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { themeMode, toggleTheme } = useTheme();
  const Icon = MODE_ICON[themeMode];
  const label = t(`shell.theme.${themeMode}`);

  return (
    <Tooltip closeDelay={80} delay={100}>
      <Button
        aria-label={t('shell.theme.toggleCurrent', { mode: label })}
        className="size-8 min-h-8 min-w-8 shrink-0 p-0"
        isIconOnly
        onPress={toggleTheme}
        size="sm"
        variant="tertiary"
      >
        <Icon className={themeMode === 'system' ? 'size-4 scale-[1.2]' : 'size-4'} />
      </Button>
      <Tooltip.Content placement="bottom">
        <p>{t('shell.theme.current', { mode: label })}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}
