import { useEffect, useState } from 'react';
import { Database, Info, Palette, Plug } from 'lucide-react';
import {
  Description,
  Label,
  Radio,
  RadioGroup,
  Surface,
  Tabs,
  ToastQueue,
} from '@heroui/react';
import {
  fetchConfig,
  type TudConfigView,
} from '@/lib/api';
import { AboutContent } from '@/components/AboutContent';
import { AppToastRegion } from './AppToastRegion';
import { LanguagePreferenceControl } from '@/components/LanguagePreferenceControl';
import { ThemePreferenceControl } from '@/components/ThemePreferenceControl';
import { AgentIntegrationSettings } from './AgentIntegrationSettings';
import { LocalBackupPanel } from './LocalBackupPanel';
import { UsageRecoveryPanel } from './UsageRecoveryPanel';
import { StatusBanner } from '@/components/StatusBanner';
import { getTokenUnitMode, setTokenUnitMode } from '@/lib/utils';
import { useLocalePreference } from '@/hooks/useLocalePreference';
import { useTheme } from '@/hooks/useTheme';
import { isDemoMode } from '@/lib/demo-runtime';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { settingsMessages } from '../i18n/settings-messages';
import {
  type SettingsTabId,
} from '@/lib/shell-events';

registerMessages(settingsMessages);

const TAB_ITEMS = [
  { id: 'appearance', labelKey: 'settings.tabs.general', Icon: Palette },
  { id: 'integrations', labelKey: 'agent.title', Icon: Plug },
  { id: 'data', labelKey: 'settings.tabs.data', Icon: Database },
  { id: 'about', labelKey: 'settings.tabs.about', Icon: Info },
] as const;

export function SettingsPanel({
  activeTab,
  onTabChange,
}: {
  activeTab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
} = {}) {
  const [toastQueue] = useState(
    () => new ToastQueue({ maxVisibleToasts: 1 }),
  );
  const { t } = useTranslation();
  const [uncontrolledTab, setUncontrolledTab] = useState<SettingsTabId>('appearance');
  const tab = activeTab ?? uncontrolledTab;
  const setTab = onTabChange ?? setUncontrolledTab;

  // Keep existing settings events pointing to their corresponding section.
  const requestedTab = tab === 'app' ? 'appearance' : tab === 'sync' ? 'data' : tab;
  const demo = isDemoMode();
  const resolvedTab = demo && requestedTab === 'integrations' ? 'appearance' : requestedTab;
  const items = TAB_ITEMS.filter(({ id }) => id !== 'integrations' || !demo);
  const panels = {
    appearance: <GeneralSettingsPanel />,
    integrations: <AgentIntegrationSettings />,
    data: <DataSettingsPanel />,
    about: <AboutContent />,
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <AppToastRegion queue={toastQueue} />
      <Tabs
        orientation="vertical"
        className="min-h-0 w-full flex-1 gap-0"
        selectedKey={resolvedTab}
        onSelectionChange={(key) => setTab(String(key) as SettingsTabId)}
      >
        <Tabs.List
          aria-label={t('settings.tabs.category')}
          className="w-32 shrink-0 gap-2 overflow-y-auto overscroll-contain border-e border-separator bg-surface-secondary/50 p-2.5 sm:w-44 sm:py-4"
        >
          {items.map(({ id, labelKey, Icon }) => (
            <Tabs.Tab
              className="group h-auto min-h-12 shrink-0 justify-start gap-2 rounded-lg px-2.5 py-2 text-start leading-snug text-foreground hover:bg-default hover:opacity-100 aria-selected:bg-accent/10 aria-selected:font-semibold aria-selected:text-foreground"
              id={id}
              key={id}
            >
              <Icon className="hidden size-4 shrink-0 text-muted group-aria-selected:text-accent sm:block" aria-hidden="true" />
              <span className="min-w-0 wrap-break-word">{t(labelKey)}</span>
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {items.map(({ id, labelKey }) => (
          <Tabs.Panel
            className="ms-0 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-4 pb-8 text-start sm:px-6 sm:pt-5"
            id={id}
            key={id}
          >
            {resolvedTab === id && (
              <>
                {id !== 'integrations' && (
                  <h2 className="mb-4 text-lg font-semibold text-foreground">{t(labelKey)}</h2>
                )}
                {panels[id]}
              </>
            )}
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}

function GeneralSettingsPanel() {
  const { t } = useTranslation();
  const { theme, themeMode, setThemeMode } = useTheme();
  const { preference, systemLocale, setPreference } = useLocalePreference();

  return (
    <div className="flex flex-col gap-4">
      <Surface className="rounded-xl p-4" variant="secondary">
        <LanguagePreferenceControl value={preference} systemLocale={systemLocale} onChange={setPreference} />
      </Surface>
      <Surface className="rounded-xl p-4" variant="secondary">
        <ThemePreferenceControl value={themeMode} theme={theme} onChange={setThemeMode} />
      </Surface>
      <Surface className="rounded-xl p-4" variant="secondary">
        <RadioGroup
          name="token-unit-mode"
          value={getTokenUnitMode()}
          variant="secondary"
          onChange={(next) => {
            if (next !== 'localized' && next !== 'international') return;
            if (next === getTokenUnitMode()) return;
            setTokenUnitMode(next);
          }}
        >
          <Label>{t('settings.tokenUnit.label')}</Label>
          <Description>{t('settings.tokenUnit.description')}</Description>
          <Radio value="localized">
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              {t('settings.tokenUnit.localized')}
            </Radio.Content>
          </Radio>
          <Radio value="international">
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              {t('settings.tokenUnit.international')}
            </Radio.Content>
          </Radio>
        </RadioGroup>
      </Surface>
    </div>
  );
}

function DataSettingsPanel() {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const [config, setConfig] = useState<TudConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchConfig()
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setError(null);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          console.error('[quotern-dashboard] failed to load config:', reason);
          setError('settings.loadConfigFailed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {loading ? <p className="text-muted">{t('settings.loadingConfig')}</p> : null}
      <LocalBackupPanel />
      <UsageRecoveryPanel />
      {error ? <StatusBanner tone="error" title={t(error)} /> : null}
      {!loading && !error && !config ? (
        <p className="text-sm text-muted">
          {t('settings.webDeviceHint')}
        </p>
      ) : null}
      {config ? (
        <Surface className="rounded-xl p-4" variant="secondary">
          <h3 className="mb-3 text-sm font-medium text-foreground">{t('settings.device.title')}</h3>
          <div className="flex flex-col gap-2 text-sm">
            <InfoRow label={t('settings.device.id')} value={config.deviceId} />
            <InfoRow
              label={t('settings.device.statsSince')}
              value={config.statsSince.slice(0, 19).replace('T', ' ')}
            />
            <InfoRow
              label={t('settings.device.lastSync')}
              value={
                config.lastSyncAt
                  ? new Date(config.lastSyncAt).toLocaleString(locale)
                  : t('settings.device.never')
              }
            />
          </div>
        </Surface>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-muted">{label}</span>
      <span className="break-all font-mono text-xs sm:text-right">{value}</span>
    </div>
  );
}
