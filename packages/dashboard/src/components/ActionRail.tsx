import {
  Loader2Icon,
  MoonIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
  SunMoonIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const glassShell =
  'rounded-[14px] border border-white/50 bg-white/55 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-black/40';

const fabBtn =
  'flex size-10 items-center justify-center rounded-[10px] text-muted opacity-45 transition-all duration-150 hover:bg-white/60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10';

const THEME_MODE_ICON: Record<ThemeMode, typeof SunMoonIcon> = {
  system: SunMoonIcon,
  light: SunIcon,
  dark: MoonIcon,
};

interface ActionRailProps {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshLabel: string;
}

/** Vertical glass rail: refresh → theme → settings. */
export function ActionRail({
  settingsOpen,
  onToggleSettings,
  onRefresh,
  refreshing,
  refreshLabel,
}: ActionRailProps) {
  const { t } = useTranslation();
  const { themeMode, toggleTheme } = useTheme();
  const ThemeModeIcon = THEME_MODE_ICON[themeMode];
  const modeLabel = t(`shell.theme.${themeMode}`);

  return (
    <div className={cn(glassShell, 'flex flex-col gap-0.5 p-1.5')}>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={refreshLabel}
        title={refreshLabel}
        className={fabBtn}
      >
        {refreshing ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <RefreshCwIcon className="size-4" />
        )}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={t('shell.theme.toggleCurrent', { mode: modeLabel })}
        title={t('shell.theme.current', { mode: modeLabel })}
        className={fabBtn}
      >
        <ThemeModeIcon className={themeMode === 'system' ? 'size-4 scale-[1.2]' : 'size-4'} />
      </button>

      <button
        type="button"
        onClick={onToggleSettings}
        aria-label={t(settingsOpen ? 'shell.closeSettings' : 'shell.openSettings')}
        title={t(settingsOpen ? 'shell.closeSettings' : 'shell.settings')}
        className={cn(fabBtn, settingsOpen && 'bg-white/70 opacity-100 text-foreground dark:bg-white/15')}
      >
        {settingsOpen ? <XIcon className="size-4" /> : <SettingsIcon className="size-4" />}
      </button>
    </div>
  );
}
