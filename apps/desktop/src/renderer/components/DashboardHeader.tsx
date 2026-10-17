import type { Key } from "@heroui/react";
import { MoonIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { THEME_MODES, type ThemeMode } from "@/lib/theme";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from 'quotern-i18n/react';

/** Dashboard top bar with theme controls. */
export function DashboardHeader() {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();

  const changeTheme = (keys: Set<Key>) => {
    const nextMode = [...keys][0] as ThemeMode;
    if (THEME_MODES.includes(nextMode)) {
      setThemeMode(nextMode);
    }
  };

  return (
    <header className="mbe-[30px] flex min-h-16 flex-wrap items-center justify-between gap-3 px-1 sm:px-0">
      <h1 className="text-3xl font-bold">Quotern</h1>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <ToggleButtonGroup
          aria-label={t('desktop.header.theme')}
          className="rounded-full bg-default p-1"
          disallowEmptySelection
          isDetached
          selectedKeys={new Set<Key>([themeMode])}
          selectionMode="single"
          size="sm"
          onSelectionChange={changeTheme}
        >
          <ToggleButton
            aria-label={t('desktop.header.themeSystem')}
            className="data-[selected=true]:bg-surface data-[selected=true]:text-foreground data-[selected=true]:shadow-sm"
            id="system"
            isIconOnly
            variant="ghost"
          >
            <SunMoonIcon className="size-4 scale-[1.2]" />
          </ToggleButton>
          <ToggleButton
            aria-label={t('desktop.header.themeLight')}
            className="data-[selected=true]:bg-surface data-[selected=true]:text-foreground data-[selected=true]:shadow-sm"
            id="light"
            isIconOnly
            variant="ghost"
          >
            <SunIcon className="size-4" />
          </ToggleButton>
          <ToggleButton
            aria-label={t('desktop.header.themeDark')}
            className="data-[selected=true]:bg-surface data-[selected=true]:text-foreground data-[selected=true]:shadow-sm"
            id="dark"
            isIconOnly
            variant="ghost"
          >
            <MoonIcon className="size-4" />
          </ToggleButton>
        </ToggleButtonGroup>
      </div>
    </header>
  );
}
