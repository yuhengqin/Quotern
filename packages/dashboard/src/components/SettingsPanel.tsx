import { useEffect, useState } from 'react';
import {
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
import { StatusBanner } from '@/components/StatusBanner';
import {
  type SettingsTabId,
} from '@/lib/shell-events';

const TAB_ITEMS: { id: SettingsTabId; label: string }[] = [
  { id: 'app', label: '应用' },
  { id: 'about', label: '关于' },
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

  if (loading) {
    return <p className="text-muted">加载配置…</p>;
  }

  if (error) {
    return <StatusBanner tone="error" title={error} />;
  }

  if (!config) {
    return (
      <p className="text-sm text-muted">
        当前为 Web 模式，设备信息仅在本机 CLI / 桌面端可见。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Surface className="rounded-xl p-4" variant="secondary">
        <h3 className="mb-3 text-sm font-medium text-foreground">设备信息</h3>
        <div className="flex flex-col gap-2 text-sm">
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
        </div>
      </Surface>
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
