import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Chip } from '@heroui/react';
import { ActionRail } from '../components/ActionRail';
import { AgentShareCard } from '../components/AgentShareCard';
import {
  AppSidebar,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from '../components/AppSidebar';
import { ModelUsageCard } from '../components/ModelUsageCard';
import { OverviewCard } from '../components/OverviewCard';
import { SettingsPanel } from '../components/SettingsPanel';
import { TimeRangeControl } from '../components/TimeRangeControl';
import { TokenTrendChart } from '../components/TokenTrendChart';
import { StatusBanner } from '../components/StatusBanner';
import {
  fetchUsageDataset,
  triggerSync,
  isCliBackend,
  apiErrorHint,
  type DailyUsageRow,
  type ModelBreakdownRow,
  type SourceUsageRow,
  type SyncStatus,
  type UsageSummary,
} from '../lib/api';
import {
  buildSummaryFromRange,
  daysForRange,
  formatRangeLabel,
  type TimeRangeKey,
} from '../lib/time-range';
import { cn } from '../lib/utils';

type NavPage = 'usage' | 'ranking';
type AppView = NavPage | 'settings';

function ModeBadge({ local }: { local: boolean }) {
  return (
    <Chip
      color={local ? 'accent' : 'default'}
      size="sm"
      variant={local ? 'primary' : 'soft'}
    >
      {local ? '本机' : '云端'}
    </Chip>
  );
}

export function App() {
  const cliBackend = isCliBackend();
  const showSidebar = !cliBackend;

  const [view, setView] = useState<AppView>('usage');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('month');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [dailyRows, setDailyRows] = useState<DailyUsageRow[]>([]);
  const [modelRows, setModelRows] = useState<ModelBreakdownRow[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [returnView, setReturnView] = useState<NavPage>('usage');

  const rangeDays = daysForRange(timeRange);

  const load = useCallback(async () => {
    try {
      const {
        summary: s,
        syncStatus: st,
        dailyRows: days,
        modelRows: modelList,
      } = await fetchUsageDataset(rangeDays);
      const statsSince = st?.statsSince ?? s?.statsSince ?? '';

      const rangeSummary = buildSummaryFromRange(days, modelList, statsSince, {
        tokens: s?.todayTokens ?? 0,
        costUsd: s?.todayCostUsd ?? 0,
      });

      setSummary(rangeSummary);
      setSyncStatus(st);
      setDailyRows(days);
      setModelRows(modelList);
      setError(null);
      setSelectedSource((prev) => {
        const sources = rangeSummary.bySource;
        if (prev && sources.some((row) => row.source === prev)) return prev;
        return sources[0]?.source ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setSummary(null);
      setSyncStatus(null);
      setDailyRows([]);
      setModelRows([]);
      setSelectedSource(null);
    }
  }, [rangeDays]);

  useEffect(() => {
    load();
    if (!cliBackend) return;
    const id = setInterval(load, 5_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load, cliBackend]);

  const onSyncOrRefresh = async () => {
    if (cliBackend) {
      setSyncing(true);
      try {
        await triggerSync();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '同步失败');
      } finally {
        setSyncing(false);
      }
      return;
    }
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const selectedRow = useMemo(
    () => summary?.bySource.find((row) => row.source === selectedSource) ?? null,
    [summary, selectedSource],
  );

  const rangeLabel = useMemo(
    () => formatRangeLabel(timeRange, syncStatus?.statsSince ?? summary?.statsSince),
    [timeRange, syncStatus?.statsSince, summary?.statsSince],
  );

  const errorHint = error ? apiErrorHint(error) : null;
  const claudeSource = syncStatus?.sources?.claude;
  const showPollBanner =
    cliBackend &&
    claudeSource?.syncMode === 'poll' &&
    claudeSource?.message;

  const navPage: NavPage = view === 'settings' ? returnView : view;

  const openSettings = () => {
    if (view !== 'settings') {
      setReturnView(view === 'ranking' ? 'ranking' : 'usage');
      setView('settings');
    } else {
      setView(returnView);
    }
  };

  const onNavigate = (page: NavPage) => {
    setReturnView(page);
    setView(page);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  };

  const pageTitle =
    view === 'settings' ? '设置' : view === 'ranking' ? '排行榜' : '用量';

  const busy = syncing || refreshing;

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Stage: sidebar column always reserves expanded width; collapse only frees the left of that column */}
      <div className="relative mx-auto flex w-full max-w-[1180px] items-start gap-3 px-3 py-8 sm:gap-4 sm:px-5 sm:py-10">
        {showSidebar && (
          <div className="sticky top-8 z-30 hidden w-44 shrink-0 self-start sm:block">
            <div className={cn(sidebarCollapsed ? 'ml-auto w-12' : 'w-44')}>
              <AppSidebar
                collapsed={sidebarCollapsed}
                onToggleCollapsed={toggleSidebar}
              />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-3">
            <h1 className="text-xl font-medium leading-7 tracking-normal sm:text-2xl sm:leading-[34px]">
              {pageTitle}
            </h1>
            <ModeBadge local={cliBackend} />
            {view === 'usage' && (
              <TimeRangeControl
                value={timeRange}
                onChange={setTimeRange}
                rangeLabel={rangeLabel}
                className="sm:ml-auto"
              />
            )}
          </div>

          {view === 'settings' ? (
            <SettingsPanel />
          ) : (
            <div className="flex flex-col gap-4">
              {showPollBanner && (
                <StatusBanner
                  tone="warn"
                  title="本机同步提示"
                  description={claudeSource.message}
                />
              )}
              {error && (
                <StatusBanner
                  tone="error"
                  title={error}
                  description={errorHint ?? undefined}
                />
              )}

              {view === 'usage' && summary && (
                <UsagePage
                  summary={summary}
                  dailyRows={dailyRows}
                  syncStatus={syncStatus}
                  modelRows={modelRows}
                  selectedSource={selectedSource}
                  selectedRow={selectedRow}
                  onSelectSource={setSelectedSource}
                />
              )}

              {view === 'ranking' && showSidebar && (
                <RankingPage />
              )}

              {view === 'usage' && !summary && !error && (
                <Card>
                  <Card.Content className="py-12 text-center text-sm text-muted">
                    加载中…
                  </Card.Content>
                </Card>
              )}
            </div>
          )}
        </main>

        <div className="sticky top-0 z-30 flex h-svh shrink-0 items-end pb-8 self-start">
          <ActionRail
            settingsOpen={view === 'settings'}
            onToggleSettings={openSettings}
            onRefresh={onSyncOrRefresh}
            refreshing={busy}
            refreshLabel={
              cliBackend
                ? syncing
                  ? '同步中…'
                  : '立即同步'
                : refreshing
                  ? '刷新中…'
                  : '刷新'
            }
          />
        </div>
      </div>

      {showSidebar && (
        <nav
          className="fixed inset-x-3 bottom-3 z-40 flex gap-1 rounded-[14px] border border-white/50 bg-white/70 p-1.5 shadow-[0_8px_24px_rgb(0_0_0/0.08)] backdrop-blur-xl sm:hidden dark:border-white/10 dark:bg-black/50"
          aria-label="移动导航"
        >
          {(
            [
              { id: 'usage' as const, label: '用量' },
              { id: 'ranking' as const, label: '排行榜' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={cn(
                'flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors',
                navPage === item.id && view !== 'settings'
                  ? 'bg-white text-foreground shadow-xs dark:bg-white/15'
                  : 'text-muted',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function UsagePage({
  summary,
  dailyRows,
  syncStatus,
  modelRows = [],
  selectedSource = null,
  selectedRow = null,
  onSelectSource,
}: {
  summary: UsageSummary;
  dailyRows: DailyUsageRow[];
  syncStatus: SyncStatus | null;
  modelRows?: ModelBreakdownRow[];
  selectedSource?: string | null;
  selectedRow?: SourceUsageRow | null;
  onSelectSource?: (source: string) => void;
}) {
  return (
    <>
      <OverviewCard
        summary={summary}
        dailyRows={dailyRows}
        modelRows={modelRows}
      />

      <section>
        <TokenTrendChart data={dailyRows} />
      </section>

      {onSelectSource && (
        <section>
          <AgentShareCard
            rows={summary.bySource}
            selectedSource={selectedSource}
            selectedRow={selectedRow}
            onSelectSource={onSelectSource}
          />
        </section>
      )}

      <section>
        <ModelUsageCard daily={dailyRows} models={modelRows} />
      </section>

      <footer className="pt-2 text-xs font-medium text-muted">
        统计自 {syncStatus?.statsSince?.slice(0, 10) ?? '—'}
        {syncStatus?.lastSyncAt && (
          <> · 上次同步 {new Date(syncStatus.lastSyncAt).toLocaleString()}</>
        )}
      </footer>
    </>
  );
}

/** Placeholder — dedicated ranking boards will live here later. */
function RankingPage() {
  return (
    <Card>
      <Card.Content className="py-16 text-center">
        <p className="text-sm font-medium text-foreground">排行榜即将上线</p>
        <p className="mt-1.5 text-sm text-muted">
          各类排行榜会放在这里，用量相关图表请前往「用量」查看。
        </p>
      </Card.Content>
    </Card>
  );
}
