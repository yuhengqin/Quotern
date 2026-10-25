import { useEffect, useState } from 'react';
import {
  Description,
  Label,
  Radio,
  RadioGroup,
  Surface,
  Tabs,
  Toast,
  ToastQueue,
} from '@heroui/react';
import {
  fetchConfig,
  type TudConfigView,
} from '@/lib/api';
import { AboutContent } from '@/components/AboutContent';
import { LanguagePreferenceControl } from '@/components/LanguagePreferenceControl';
import { ThemePreferenceControl } from '@/components/ThemePreferenceControl';
import { StatusBanner } from '@/components/StatusBanner';
import { getTokenUnitMode, setTokenUnitMode } from '@/lib/utils';
import { useLocalePreference } from '@/hooks/useLocalePreference';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { settingsMessages } from '../i18n/settings-messages';
import {
  type SettingsTabId,
} from '@/lib/shell-events';

registerMessages(settingsMessages);

const TAB_ITEMS: { id: SettingsTabId; labelKey: string }[] = [
  { id: 'app', labelKey: 'settings.tabs.app' },
  { id: 'about', labelKey: 'settings.tabs.about' },
];

/** See desktop SettingsPanel: panel height must fit under dialog chrome. */
const SETTINGS_SCROLL_PANEL =
  'max-h-[calc(90vh-9rem)] overflow-y-auto p-4 pb-8 text-left';

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
  const [uncontrolledTab, setUncontrolledTab] = useState<SettingsTabId>('app');
  const tab = activeTab ?? uncontrolledTab;
  const setTab = onTabChange ?? setUncontrolledTab;

  // Synchronization settings are shown in the application panel.
  const resolvedTab: SettingsTabId = tab === 'sync' ? 'app' : tab;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Toast.Provider placement="top end" queue={toastQueue} />
      <Tabs
        className="flex min-h-0 w-full flex-1 flex-col text-center"
        selectedKey={resolvedTab}
        onSelectionChange={(key) => setTab(String(key) as SettingsTabId)}
      >
        <Tabs.ListContainer className="m-3 mr-14 w-fit">
          <Tabs.List aria-label={t('settings.tabs.category')} className="w-fit">
            {TAB_ITEMS.map((item) => (
              <Tabs.Tab
                className="h-6 w-fit px-3 text-xs font-normal aria-selected:text-accent-foreground"
                id={item.id}
                key={item.id}
              >
                {t(item.labelKey)}
                <Tabs.Indicator className="bg-accent" />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel className={SETTINGS_SCROLL_PANEL} id="app">
          {resolvedTab === 'app' && <AppSettingsPanel />}
        </Tabs.Panel>
        <Tabs.Panel className={SETTINGS_SCROLL_PANEL} id="about">
          {resolvedTab === 'about' && <AboutContent />}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function AppSettingsPanel() {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();
  const { preference, locale, systemLocale, setPreference } = useLocalePreference();
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
      .catch((e) => {
        if (!cancelled) {
          console.error('[quotern-dashboard] failed to load config:', e);
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
      <Surface className="rounded-xl p-4" variant="secondary">
        <LanguagePreferenceControl value={preference} systemLocale={systemLocale} onChange={setPreference} />
      </Surface>
      <Surface className="rounded-xl p-4" variant="secondary">
        <ThemePreferenceControl value={themeMode} onChange={setThemeMode} />
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
            window.location.reload();
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
      {loading ? <p className="text-muted">{t('settings.loadingConfig')}</p> : null}
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
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="break-all text-right font-mono text-xs">{value}</span>
    </div>
  );
}
