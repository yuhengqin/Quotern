import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Description,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Select,
  Tabs,
  Toast,
  ToastQueue,
} from '@heroui/react';
import {
  getLatestUpdateVersion,
  getUpdateToolbarAction,
  PORTABLE_RELEASES_URL,
  updateDownloadPercent,
  type AutoUpdateState,
} from '../../shared/auto-update';
import { resolveAutoUpdateStateForUi } from '@/lib/mock-portable-update';
import { isTrayUsageMode, type TrayUsageMode } from '../../shared/tray-usage';
import {
  fetchConfig,
  type TudConfigView,
} from '@/lib/api';
import { AboutContent } from '@/components/AboutContent';
import { StatusBanner } from '@/components/StatusBanner';
import { PetSettingsCard } from '@/components/PetSettingsCard';
import { DshPetSettingsCard } from '@/components/DshPetSettingsCard';
import { useLocalePreference } from '@/hooks/useLocalePreference';
import { useTranslation } from 'quotern-i18n/react';
import { LanguagePreferenceControl } from '../../../../../packages/dashboard/src/components/LanguagePreferenceControl';
import { getTokenUnitMode, setTokenUnitMode } from '@/lib/utils';
import { QuotaSettings } from './QuotaSettings';

import {
  type SettingsTabId,
} from '@/lib/shell-events';

type DesktopSettingsTabId = SettingsTabId;

const TAB_ITEMS: { id: DesktopSettingsTabId; labelKey: string }[] = [
  { id: 'subscription', labelKey: 'settings.tabs.subscription' },
  { id: 'app', labelKey: 'settings.tabs.app' },
  { id: 'about', labelKey: 'settings.tabs.about' },
];

/**
 * Dialog is `max-h-[90vh]`. Header + tab list take ~9rem, so a 78vh panel
 * overflows the body and gets clipped. Bound the panel to the leftover space
 * so `overflow-y-auto` both scrolls and stays fully visible.
 */
const SETTINGS_SCROLL_PANEL =
  'max-h-[calc(90vh-9rem)] overflow-y-auto p-4 pb-8 text-left';

export function SettingsPanel({
  activeTab,
  onTabChange,
}: {
  activeTab?: DesktopSettingsTabId;
  onTabChange?: (tab: DesktopSettingsTabId) => void;
} = {}) {
  const [toastQueue] = useState(
    () => new ToastQueue({ maxVisibleToasts: 1 }),
  );
  const { t } = useTranslation();
  const [uncontrolledTab, setUncontrolledTab] =
    useState<DesktopSettingsTabId>('app');
  const tab = activeTab ?? uncontrolledTab;
  const setTab = onTabChange ?? setUncontrolledTab;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Toast.Provider placement="top end" queue={toastQueue} />
      <Tabs
        className="flex min-h-0 w-full flex-1 flex-col text-center"
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key) as DesktopSettingsTabId)}
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
          {tab === 'app' && <AppSettingsPanel />}
        </Tabs.Panel>
        <Tabs.Panel className={SETTINGS_SCROLL_PANEL} id="subscription">
          {tab === 'subscription' && <SubscriptionChannelSettings />}
        </Tabs.Panel>
        <Tabs.Panel className={SETTINGS_SCROLL_PANEL} id="about">
          {tab === 'about' && <AboutContent />}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

/** Toggle which auto-detected subscription channels may appear on the dashboard. */
function SubscriptionChannelSettings() {
  return <QuotaSettings />;
}

/** 自动更新 + 开机自启 + 设备信息。 */
function AppSettingsPanel() {
  const { t } = useTranslation();
  const { preference, locale, setPreference } = useLocalePreference();
  const [localeError, setLocaleError] = useState(false);
  const cliMode = true;
  const isMac = window.tud?.platform === 'darwin';
  const isWindows = window.tud?.platform === 'win32';
  const [config, setConfig] = useState<TudConfigView | null>(null);
  const [openAtLogin, setOpenAtLogin] = useState(true);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [launchHidden, setLaunchHidden] = useState(true);
  const [showTrayUsage, setShowTrayUsage] = useState(true);
  const [trayUsageMode, setTrayUsageMode] = useState<TrayUsageMode>('both');
  const [trayUsageLoading, setTrayUsageLoading] = useState(true);
  const [trayUsageError, setTrayUsageError] = useState<string | null>(null);
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
          console.error('[quotern-desktop] failed to load config:', e);
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

  useEffect(() => {
    let cancelled = false;
    setAutostartLoading(true);
    void window.tud
      .getOpenAtLogin()
      .then((value) => {
        if (!cancelled) {
          setOpenAtLogin(value);
          setAutostartError(null);
        }
      })
      .then(() => {
        if (cancelled) return;
        return window.tud.getLaunchHidden().then((value) => {
          if (!cancelled) setLaunchHidden(value);
        });
      })
      .catch((e) => {
        if (!cancelled) {
          console.error('[quotern-desktop] failed to load autostart settings:', e);
          setAutostartError('settings.autostart.loadFailed');
        }
      })
      .finally(() => {
        if (!cancelled) setAutostartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onOpenAtLoginChange = async (next: boolean) => {
    const prev = openAtLogin;
    setOpenAtLogin(next);
    setAutostartError(null);
    try {
      await window.tud.setOpenAtLogin(next);
    } catch (e) {
      setOpenAtLogin(prev);
      console.error('[quotern-desktop] failed to update autostart:', e);
      setAutostartError('settings.autostart.updateFailed');
    }
  };

  const onLaunchHiddenChange = async (next: boolean) => {
    const prev = launchHidden;
    setLaunchHidden(next);
    try {
      await window.tud.setLaunchHidden(next);
    } catch (e) {
      setLaunchHidden(prev);
      console.error('[quotern-desktop] failed to update quiet launch:', e);
      setAutostartError('settings.autostart.hiddenUpdateFailed');
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (isMac && typeof window.tud?.getShowTrayUsage === 'function') {
      setTrayUsageLoading(true);
      void Promise.all([
        window.tud.getShowTrayUsage(),
        window.tud.getTrayUsageMode(),
      ])
        .then(([enabled, mode]) => {
          if (!cancelled) {
            setShowTrayUsage(enabled);
            setTrayUsageMode(mode);
            setTrayUsageError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            console.error('[quotern-desktop] failed to load tray usage settings:', e);
            setTrayUsageError('settings.tray.loadFailed');
          }
        })
        .finally(() => {
          if (!cancelled) setTrayUsageLoading(false);
        });
    } else {
      setTrayUsageLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [isMac]);

  const onShowTrayUsageChange = async (next: boolean) => {
    const prev = showTrayUsage;
    setShowTrayUsage(next);
    setTrayUsageError(null);
    try {
      await window.tud.setShowTrayUsage(next);
    } catch (e) {
      setShowTrayUsage(prev);
      console.error('[quotern-desktop] failed to update tray usage:', e);
      setTrayUsageError('settings.tray.updateFailed');
    }
  };

  const onTrayUsageModeChange = async (next: TrayUsageMode) => {
    const prev = trayUsageMode;
    setTrayUsageMode(next);
    setTrayUsageError(null);
    try {
      await window.tud.setTrayUsageMode(next);
    } catch (e) {
      setTrayUsageMode(prev);
      console.error('[quotern-desktop] failed to update tray display mode:', e);
      setTrayUsageError('settings.tray.modeUpdateFailed');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card variant="tertiary" className="rounded-xl shadow-none">
        <Card.Content>
          <LanguagePreferenceControl
            value={preference}
            onChange={(next) => {
              setLocaleError(false);
              void setPreference(next).catch((reason) => {
                console.error('[quotern-desktop] failed to persist locale:', reason);
                setLocaleError(true);
              });
            }}
          />
        </Card.Content>
      </Card>
      {localeError && <StatusBanner tone="error" title={t('settings.language.saveFailed')} />}
      {error && <StatusBanner tone="error" title={t(error)} />}
      {autostartError && (
        <StatusBanner tone="error" title={t(autostartError)} />
      )}
      {trayUsageError && (
        <StatusBanner tone="error" title={t(trayUsageError)} />
      )}

      {cliMode && (
        <div className="flex flex-col gap-2">
          <Checkbox
            id="desktop-open-at-login"
            isDisabled={autostartLoading}
            isSelected={openAtLogin}
            onChange={(checked) => {
              void onOpenAtLoginChange(checked);
            }}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {t('settings.autostart.enable')}
            </Checkbox.Content>
          </Checkbox>
          {openAtLogin && (
            <>
              <Checkbox
                id="desktop-launch-hidden"
                isDisabled={autostartLoading}
                isSelected={launchHidden}
                onChange={(checked) => {
                  void onLaunchHiddenChange(checked);
                }}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  {t('settings.autostart.hidden')}
                </Checkbox.Content>
              </Checkbox>
              {launchHidden && (
                <p className="text-xs text-muted">
                  {t('settings.autostart.hiddenHint')}
                </p>
              )}
            </>
          )}
          {isMac && (
            <>
              <Checkbox
                id="desktop-show-tray-usage"
                isDisabled={trayUsageLoading}
                isSelected={showTrayUsage}
                onChange={(checked) => {
                  void onShowTrayUsageChange(checked);
                }}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  {t('settings.tray.enable')}
                </Checkbox.Content>
              </Checkbox>
              {showTrayUsage && (
                <div className="mt-2 max-w-xs pl-4">
                  <Select
                    aria-label={t('settings.tray.modeAria')}
                    isDisabled={trayUsageLoading}
                    value={trayUsageMode}
                    variant="secondary"
                    onChange={(value) => {
                      if (isTrayUsageMode(value)) {
                        void onTrayUsageModeChange(value);
                      }
                    }}
                  >
                    <Label>{t('settings.tray.modeLabel')}</Label>
                    <Select.Trigger>
                      <Select.Value>{({ selectedText }) => selectedText}</Select.Value>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox aria-label={t('settings.tray.modeListAria')}>
                        <ListBox.Item id="both" textValue={t('settings.tray.both')}>
                          {t('settings.tray.both')}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="tokens" textValue={t('settings.tray.tokens')}>
                          {t('settings.tray.tokens')}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="cost" textValue={t('settings.tray.cost')}>
                          {t('settings.tray.cost')}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {isWindows && <PetSettingsCard />}
      {isWindows && <DshPetSettingsCard />}

      <Card variant="tertiary" className="rounded-xl shadow-none">
        <Card.Content>
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
        </Card.Content>
      </Card>

      <AutoUpdateSettings />

      {!loading && config && (
        <Card variant="tertiary" className="rounded-xl shadow-none">
          <Card.Header>
            <Card.Title>{t('settings.device.title')}</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2 text-sm">
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
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

function AutoUpdateSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<AutoUpdateState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installPending, setInstallPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let receivedEvent = false;
    const unsubscribe = window.tud.onAutoUpdateStateChanged((next) => {
      receivedEvent = true;
      if (!cancelled) {
        setState(resolveAutoUpdateStateForUi(next));
        if (next.status !== 'error') setActionError(null);
      }
    });
    void window.tud
      .getAutoUpdateState()
      .then((next) => {
        if (!cancelled && !receivedEvent) {
          setState(resolveAutoUpdateStateForUi(next));
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          console.error('[quotern-desktop] failed to read update state:', reason);
          setActionError('settings.update.readFailed');
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const check = async () => {
    setActionError(null);
    try {
      setState(resolveAutoUpdateStateForUi(await window.tud.checkForUpdates()));
    } catch (reason) {
      console.error('[quotern-desktop] failed to check updates:', reason);
      setActionError('settings.update.checkFailed');
    }
  };

  const install = async () => {
    setActionError(null);
    setInstallPending(true);
    try {
      await window.tud.installDownloadedUpdate();
    } catch (reason) {
      console.error('[quotern-desktop] failed to install update:', reason);
      setActionError('settings.update.installFailed');
    } finally {
      setInstallPending(false);
    }
  };

  const openPortableReleases = async () => {
    setActionError(null);
    try {
      const result = await window.tud.openExternal(PORTABLE_RELEASES_URL);
      if (!result.ok) {
        console.error('[quotern-desktop] failed to open releases:', result.message);
        setActionError('settings.update.openReleasesFailed');
      }
    } catch (reason) {
      console.error('[quotern-desktop] failed to open releases:', reason);
      setActionError('settings.update.openReleasesFailed');
    }
  };

  const status = state?.status ?? 'idle';
  const busy =
    status === 'checking' ||
    status === 'downloading' ||
    status === 'downloaded' ||
    status === 'installing';
  const messageKey = !state ? 'settings.update.loading'
    : status === 'unsupported' ? 'settings.update.unsupported'
    : status === 'checking' ? 'settings.update.checking'
    : status === 'available' ? 'settings.update.available'
    : status === 'error' ? 'settings.update.retry'
    : status === 'idle' ? 'settings.update.idle'
    : null;
  const message = messageKey ? t(messageKey) : null;
  const latestVersion = getLatestUpdateVersion(state);
  const error = actionError ? t(actionError) : status === 'error' ? t('settings.update.retry') : null;
  // Check failures can be retried with the persistent check button.
  const updateAction = status === 'error' ? null : getUpdateToolbarAction(state);
  const updateActionLabel = status === 'available' ? t('settings.update.available')
    : status === 'downloading' ? state?.percent == null
      ? t('settings.update.downloading')
      : t('settings.update.downloadPercent', { percent: updateDownloadPercent(state?.percent) })
    : status === 'downloaded' ? t('settings.update.restart')
    : status === 'installing' ? t('settings.update.restarting')
    : updateAction?.label;

  return (
    <Card className="rounded-xl shadow-none" variant="tertiary">
      <Card.Header>
        <div className="flex w-full items-center justify-between gap-4">
          <Card.Title>{t('settings.update.title')}</Card.Title>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              className="shrink-0"
              isDisabled={!state || status === 'unsupported' || busy || installPending}
              isPending={status === 'checking'}
              onPress={() => {
                void check();
              }}
              size="sm"
              variant="outline"
            >
              {t('settings.update.check')}
            </Button>
            {updateAction && (
              <Button
                aria-busy={installPending || updateAction.request === null}
                className="shrink-0"
                isDisabled={installPending || updateAction.request === null}
                onPress={() => {
                  if (updateAction.request === 'install') void install();
                  if (updateAction.request === 'open-releases') void openPortableReleases();
                }}
                size="sm"
                variant="primary"
              >
                {updateActionLabel}
              </Button>
            )}
          </div>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <InfoRow
          label={t('settings.update.current')}
          value={`v${state?.currentVersion ?? '—'}`}
        />
        {latestVersion && (
          <InfoRow label={t('settings.update.latest')} value={`v${latestVersion}`} />
        )}

        {error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('settings.update.failed')}</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {message && status === 'available' ? (
          <p className="text-xs text-muted">
            {t('settings.update.portableHint')}{' '}
            <button
              className="text-[#1e80ff] underline-offset-2 hover:underline"
              onClick={() => {
                void openPortableReleases();
              }}
              type="button"
            >
              {t('settings.update.releases')}
            </button>
          </p>
        ) : message ? (
          <p className="text-xs text-muted">{message}</p>
        ) : null}
      </Card.Content>
    </Card>
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
