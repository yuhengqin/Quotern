import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Description,
  Label,
  ListBox,
  Select,
  Tabs,
  Toast,
  ToastQueue,
} from '@heroui/react';
import {
  getLatestUpdateVersion,
  getUpdateToolbarAction,
  PORTABLE_RELEASES_URL,
  updateStatusMessage,
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
import { useSubscriptionChannelVisibility } from '@/hooks/useSubscriptionChannelVisibility';
import { SUBSCRIPTION_CHANNELS } from '../../shared/subscription-channels';

import {
  type SettingsTabId,
} from '@/lib/shell-events';

type DesktopSettingsTabId = SettingsTabId;

const TAB_ITEMS: { id: DesktopSettingsTabId; label: string }[] = [
  { id: 'subscription', label: '订阅' },
  { id: 'app', label: '应用' },
  { id: 'about', label: '关于' },
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
          <Tabs.List aria-label="设置分类" className="w-fit">
            {TAB_ITEMS.map((item) => (
              <Tabs.Tab
                className="h-6 w-fit px-3 text-xs font-normal aria-selected:text-accent-foreground"
                id={item.id}
                key={item.id}
              >
                {item.label}
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
  const { isEnabled, setChannelEnabled, setAllEnabled } =
    useSubscriptionChannelVisibility();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-foreground">订阅额度卡片</p>
        <Description>
          控制用量页展示哪些订阅额度卡片。默认全部开启；本机未登录或未识别到额度时仍会自动隐藏。
        </Description>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onPress={() => setAllEnabled(true)}>
          全部开启
        </Button>
        <Button size="sm" variant="tertiary" onPress={() => setAllEnabled(false)}>
          全部关闭
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SUBSCRIPTION_CHANNELS.map((channel) => (
          <Checkbox
            id={`subscription-channel-${channel.id}`}
            isSelected={isEnabled(channel.id)}
            key={channel.id}
            onChange={(checked) => {
              setChannelEnabled(channel.id, checked);
            }}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {channel.label}
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </div>
  );
}

/** 自动更新 + 开机自启 + 设备信息。 */
function AppSettingsPanel() {
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
          setError(e instanceof Error ? e.message : '加载配置失败');
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
          setAutostartError(
            e instanceof Error ? e.message : '加载开机自启设置失败',
          );
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
      setAutostartError(
        e instanceof Error ? e.message : '更新开机自启失败',
      );
    }
  };

  const onLaunchHiddenChange = async (next: boolean) => {
    const prev = launchHidden;
    setLaunchHidden(next);
    try {
      await window.tud.setLaunchHidden(next);
    } catch (e) {
      setLaunchHidden(prev);
      setAutostartError(
        e instanceof Error ? e.message : '更新静默启动设置失败',
      );
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
            setTrayUsageError(
              e instanceof Error ? e.message : '加载托盘用量设置失败',
            );
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
      setTrayUsageError(
        e instanceof Error ? e.message : '更新托盘用量设置失败',
      );
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
      setTrayUsageError(
        e instanceof Error ? e.message : '更新托盘用量显示方式失败',
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <StatusBanner tone="error" title={error} />}
      {autostartError && (
        <StatusBanner tone="error" title={autostartError} />
      )}
      {trayUsageError && (
        <StatusBanner tone="error" title={trayUsageError} />
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
              开机时自动启动
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
                  静默启动
                </Checkbox.Content>
              </Checkbox>
              {launchHidden && (
                <p className="text-xs text-muted">
                  开机后只出现托盘，不弹出主窗口
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
                  在菜单栏托盘显示今日用量
                </Checkbox.Content>
              </Checkbox>
              {showTrayUsage && (
                <div className="mt-2 max-w-xs pl-4">
                  <Select
                    aria-label="菜单栏用量显示方式"
                    isDisabled={trayUsageLoading}
                    value={trayUsageMode}
                    variant="secondary"
                    onChange={(value) => {
                      if (isTrayUsageMode(value)) {
                        void onTrayUsageModeChange(value);
                      }
                    }}
                  >
                    <Label>显示方式</Label>
                    <Select.Trigger>
                      <Select.Value>{({ selectedText }) => selectedText}</Select.Value>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox aria-label="菜单栏用量显示方式列表">
                        <ListBox.Item id="both" textValue="Token 和金额">
                          Token 和金额
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="tokens" textValue="仅 Token">
                          仅 Token
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="cost" textValue="仅金额">
                          仅金额
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

      <AutoUpdateSettings />

      {!loading && config && (
        <Card variant="tertiary" className="rounded-xl shadow-none">
          <Card.Header>
            <Card.Title>设备信息</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2 text-sm">
            <InfoRow label="设备 ID" value={config.deviceId} />
            <InfoRow
              label="统计起点"
              value={config.statsSince.slice(0, 19).replace('T', ' ')}
            />
            <InfoRow
              label="上次同步"
              value={
                config.lastSyncAt
                  ? new Date(config.lastSyncAt).toLocaleString()
                  : '从未'
              }
            />
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

function AutoUpdateSettings() {
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
          setActionError(
            reason instanceof Error ? reason.message : '读取更新状态失败',
          );
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
      setActionError(
        reason instanceof Error ? reason.message : '检查更新失败',
      );
    }
  };

  const install = async () => {
    setActionError(null);
    setInstallPending(true);
    try {
      await window.tud.installDownloadedUpdate();
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : '更新并重启失败',
      );
    } finally {
      setInstallPending(false);
    }
  };

  const openPortableReleases = async () => {
    setActionError(null);
    try {
      const result = await window.tud.openExternal(PORTABLE_RELEASES_URL);
      if (!result.ok) {
        setActionError(result.message ?? '无法打开 GitHub 发行版页面');
      }
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : '无法打开 GitHub 发行版页面',
      );
    }
  };

  const status = state?.status ?? 'idle';
  const busy =
    status === 'checking' ||
    status === 'downloading' ||
    status === 'downloaded' ||
    status === 'installing';
  const message = updateStatusMessage(state);
  const latestVersion = getLatestUpdateVersion(state);
  const error = actionError ?? (status === 'error' ? state?.message : null);
  // Check failures can be retried with the persistent check button.
  const updateAction = status === 'error' ? null : getUpdateToolbarAction(state);

  return (
    <Card className="rounded-xl shadow-none" variant="tertiary">
      <Card.Header>
        <div className="flex w-full items-center justify-between gap-4">
          <Card.Title>应用更新</Card.Title>
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
              检查更新
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
                {updateAction.label}
              </Button>
            )}
          </div>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <InfoRow
          label="当前版本"
          value={`v${state?.currentVersion ?? '—'}`}
        />
        {latestVersion && (
          <InfoRow label="最新版本" value={`v${latestVersion}`} />
        )}

        {error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>更新失败</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {message && status === 'available' ? (
          <p className="text-xs text-muted">
            发现新版本，请到{' '}
            <button
              className="text-[#1e80ff] underline-offset-2 hover:underline"
              onClick={() => {
                void openPortableReleases();
              }}
              type="button"
            >
              GitHub 发行版
            </button>
            {' '}下载便携版
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
