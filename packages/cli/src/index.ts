import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

import {
  appendJsonLog,
  BucketStore,
  createAggregateCache,
  createApplyAfterSync,
  createHttpServer,
  createLocalApiApp,
  createPollBackoff,
  DEFAULT_PORT,
  getHookStatus,
  getRunningOwner,
  listenServer,
  loadConfig,
  POLL_INTERVAL_MS,
  releaseRuntimeOwner,
  resolveLocalCollectSince,
  saveConfig,
  setupClaudeHook,
  setupCodexHook,
  syncAll,
  collectWrittenBuckets,
  syncLogPath,
  touchStatsSince,
  watchRuntimeSignals,
  watchSyncSignals,
  writeSyncDone,
  resolvePricingRefreshConfig,
  DEFAULT_PRICING_FIRST_FETCH_TIMEOUT_MS,
  startPricingRefresh,
  runDoctorDiagnostics,
  readUsageReport,
  resolveDataDir,
  type AggregateCache,
  type SyncResult,
  type TudConfig,
} from 'quotern-core';

import {
  DEFAULT_HOST,
  formatListenUrl,
  isWildcardListenHost,
  parseArgs,
  printHelp,
  resolveDaysAgo,
  resolveSyncSource,
} from './args.js';
import { writePid } from './daemon.js';
import { printDoctorReport } from './doctor.js';
import { cmdServiceStart, cmdServiceStatus, cmdServiceStop } from './service.js';
import { createQuotaRuntime, type QuotaManager } from 'quotern-core/quota/runtime';
import { parseUsageArgs } from './usage-args.js';
import { formatUsageReport } from './usage-output.js';
import { runStatusline } from './statusline.js';
import type { SupportedLocale } from 'quotern-i18n';
import { CliUserError, cliT, extractCliLanguage, previewCliLocale, systemCliLocale, userError } from './i18n/locale.js';

export { parseArgs } from './args.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let server: Server | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let syncWatcherStop: (() => void) | null = null;
let pricingRefreshStop: (() => void) | null = null;
let quotaRuntime: QuotaManager | null = null;
let runSyncFn: ((reason: string, source?: string) => Promise<SyncResult[]>) | null =
  null;
let runtime: {
  dir: string;
  config: TudConfig;
  bucketStore: BucketStore;
  aggregateCache: AggregateCache;
} | null = null;
let runtimeDataDir: string | null = null;
/** True only when this process wrote `tud.pid` as local collection owner. */
let ownedPid = false;
let runtimeRole: 'owner' | 'observer' = 'owner';
let activeLocale: SupportedLocale = systemCliLocale();

const t = (key: string, options?: Record<string, unknown>) => cliT(activeLocale, key, options);
const runtimeLabel = (kind: 'cli' | 'desktop') => t(`common.kind.${kind}`);
const count = (value: number) => new Intl.NumberFormat(activeLocale).format(value);
const pollInterval = () => POLL_INTERVAL_MS < 60_000
  ? t('common.second', { count: count(Math.max(1, Math.round(POLL_INTERVAL_MS / 1_000))) })
  : t('common.minute', { count: count(Math.round(POLL_INTERVAL_MS / 60_000)) });
function displayDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return t('common.never');
  return new Intl.DateTimeFormat(activeLocale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
}
function diagnosticDetail(err: unknown): void {
  if (process.env.QUOTERN_DEBUG !== '1') return;
  console.error(t('common.debugDetails', { details: err instanceof Error ? err.message : String(err) }));
}

async function startPricingOverlayRefresh(
  dir: string,
  config: TudConfig,
): Promise<void> {
  pricingRefreshStop?.();
  pricingRefreshStop = null;
  const { url } = resolvePricingRefreshConfig({
    url: config.pricing?.url,
    ttlMs: config.pricing?.ttlMs,
  });
  if (!url) return;
  const handle = startPricingRefresh({
    url,
    dataDir: dir,
    firstFetchTimeoutMs: DEFAULT_PRICING_FIRST_FETCH_TIMEOUT_MS,
    onUpdate: () => {
      const current = runtime;
      if (!current) return;
      void current.aggregateCache
        .rebuildFromRows(current.bucketStore.getRows())
        .catch((err) => {
          console.warn(t('start.pricingCacheFailed'));
          diagnosticDetail(err);
        });
    },
    onError: (err) => {
      console.warn(t('start.pricingRefreshFailed'));
      diagnosticDetail(err);
    },
  });
  pricingRefreshStop = handle;
  console.log(t('start.pricingOverlay', { url }));
  await handle.ready;
}

function resolveDashboardDir(): string {
  return join(__dirname, 'dashboard');
}

function resolveCliBinPath(): string {
  return fileURLToPath(new URL('../bin/quotern.js', import.meta.url));
}

async function refreshRuntimeFromDisk(
  results?: SyncResult[],
): Promise<void> {
  if (!runtime) return;
  try {
    const { config } = await loadConfig(runtime.dir);
    runtime.config = config;
    if (results) {
      const written = collectWrittenBuckets(results);
      if (written.length > 0) {
        runtime.bucketStore.apply(written);
      }
      await runtime.aggregateCache.onBucketsChanged(
        runtime.bucketStore.getRows(),
        written,
      );
      await appendJsonLog(syncLogPath(runtime.dir), {
        event: 'bucket_apply',
        written: written.length,
        statsSince: config.statsSince,
        localCollectSince: resolveLocalCollectSince(config),
        lastSyncAt: config.lastSyncAt,
      });
      return;
    }
    await runtime.bucketStore.refresh(
      runtime.dir,
      resolveLocalCollectSince(config),
    );
    await runtime.aggregateCache.rebuildFromRows(runtime.bucketStore.getRows());
    await appendJsonLog(syncLogPath(runtime.dir), {
      event: 'bucket_refresh',
      statsSince: config.statsSince,
      localCollectSince: resolveLocalCollectSince(config),
      lastSyncAt: config.lastSyncAt,
    });
  } catch (err) {
    await appendJsonLog(syncLogPath(runtime.dir), {
      event: 'bucket_refresh_error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function cmdStart(portArg?: number, hostArg?: string, daysAgo?: number): Promise<void> {
  const { dir, config } = await loadConfig();

  const existing = await getRunningOwner(dir);
  if (existing != null && existing.pid !== process.pid && existing.kind === 'cli') {
    throw userError(activeLocale, 'start.alreadyRunning', { pid: existing.pid });
  }

  // Desktop already owns local collection → serve panel only (observer).
  const isObserver =
    existing != null && existing.pid !== process.pid && existing.kind === 'desktop';
  runtimeRole = isObserver ? 'observer' : 'owner';
  ownedPid = false;
  runtimeDataDir = dir;

  // Claim ownership before hook/bucket/listen work so `quotern service start`
  // can observe the pid file within its wait window.
  if (!isObserver) {
    await writePid(process.pid, dir, 'cli');
    ownedPid = true;
  }

  await touchStatsSince(dir, config, daysAgo != null ? { daysAgo } : undefined);
  const port = portArg ?? config.serverPort ?? DEFAULT_PORT;
  const host = hostArg ?? config.serverHost ?? DEFAULT_HOST;
  config.serverPort = port;
  config.serverHost = host;
  await saveConfig(dir, config);

  console.log(t('start.device', { uuid: config.deviceId }));

  if (isObserver && existing) {
    console.log(`\n◎ ${t('start.observer', { kind: runtimeLabel(existing.kind), pid: existing.pid })}`);
    console.log(`  ${t('start.observerDetail')}\n`);
  }

  const { hookOk: claudeHookOk } = await setupClaudeHook(dir);
  const { hookOk: codexHookOk } = await setupCodexHook(dir);
  if (!isObserver) {
    if (!claudeHookOk) {
      console.warn(t('start.hookFailed', { source: 'Claude', interval: pollInterval() }));
    }
    if (!codexHookOk) {
      console.warn(t('start.hookFailed', { source: 'Codex', interval: pollInterval() }));
    }
  }

  const { config: refreshed } = await loadConfig(dir);
  await startPricingOverlayRefresh(dir, refreshed);

  const bucketStore = new BucketStore();
  await bucketStore.reload(dir, resolveLocalCollectSince(refreshed));
  const aggregateCache = await createAggregateCache(dir, bucketStore.getRows());
  runtime = { dir, config: refreshed, bucketStore, aggregateCache };
  runtimeDataDir = dir;

  // Idle rounds back off 1min → 2min → 5min; hook/manual activity re-arms at 1min.
  const pollBackoff = createPollBackoff();
  let reArmPoll: (() => void) | null = null;
  const resetPollBackoffToFast = () => {
    const wasSlow = pollBackoff.currentDelayMs() > POLL_INTERVAL_MS;
    pollBackoff.reset();
    if (wasSlow) reArmPoll?.();
  };

  if (isObserver) {
    syncWatcherStop = watchSyncSignals(dir, async (filename) => {
      if (filename === 'sync.done') {
        await refreshRuntimeFromDisk();
      }
    });
    runSyncFn = null;
  } else {
    const applyAfterSync = createApplyAfterSync({
      getBucketStore: () => runtime!.bucketStore,
      getAggregateCache: () => runtime?.aggregateCache,
    });
    const { stop, runSync } = watchRuntimeSignals({
      dataDir: dir,
      getConfig: () => runtime!.config,
      setConfig: (next: TudConfig) => {
        if (runtime) runtime.config = next;
      },
      refreshFromDisk: async (results, opts) => {
        // Non-quiet result delivery means a hook/manual sync ran: user active.
        if (results && results.length > 0 && !opts?.quiet) {
          resetPollBackoffToFast();
        }
        if (!results) {
          await refreshRuntimeFromDisk();
          return;
        }
        await applyAfterSync(results, opts);
      },
      isOwner: () => runtimeRole === 'owner',
      loadConfig,
    });
    syncWatcherStop = stop;
    runSyncFn = runSync;
  }

  const getConfig = () => runtime!.config;

  // CLI owns its quota history; Electron keeps its existing userData store.
  quotaRuntime = await createQuotaRuntime({ directory: join(dir, 'quota') });

  const app = createLocalApiApp({
    quota: quotaRuntime,
    dataDir: dir,
    getConfig,
    bucketStore,
    aggregateCache,
    runSyncViaRunner: runSyncFn
      ? (reason, source) => runSyncFn!(reason, source)
      : undefined,
    getHookStatus: () => getHookStatus(dir),
    onConfigChange: (next) => {
      if (runtime) runtime.config = next;
    },
  });

  const httpServer = createHttpServer({
    honoApp: app,
    staticDir: resolveDashboardDir(),
    host,
    port,
  });

  let actualPort: number;
  try {
    ({ port: actualPort } = await listenServer(httpServer, host, port));
  } catch (err) {
    quotaRuntime.dispose();
    quotaRuntime = null;
    if (ownedPid) {
      await releaseRuntimeOwner(dir);
      ownedPid = false;
    }
    throw err;
  }
  server = httpServer;

  if (!isObserver) {
    quotaRuntime.start();
    // Schedule next poll only after the previous one settles (avoid overlap).
    const scheduleNextPoll = (delayMs = pollBackoff.currentDelayMs()) => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      if (!runtime || runtimeRole !== 'owner' || !runSyncFn) return;
      pollTimer = setTimeout(() => {
        void (async () => {
          let nextDelayMs = pollBackoff.currentDelayMs();
          try {
            if (!runtime || runtimeRole !== 'owner' || !runSyncFn) return;
            const results = await runSyncFn('poll');
            const wroteAny = results.some((r) => r.writtenBuckets.length > 0 || r.sessionsChanged);
            nextDelayMs = pollBackoff.noteRound(wroteAny);
          } catch (err) {
            console.error(t('start.pollFailed'));
            diagnosticDetail(err);
          } finally {
            scheduleNextPoll(nextDelayMs);
          }
        })();
      }, delayMs);
    };
    reArmPoll = () => scheduleNextPoll();

    console.log(t('start.backgroundSync'));
    void runSyncFn?.('startup')
      .catch((err) => {
        console.error(t('start.startupSyncFailed'));
        diagnosticDetail(err);
      })
      .finally(scheduleNextPoll);
  }

  const url = formatListenUrl(host, actualPort);
  console.log(`\n${t('start.started', { observer: isObserver ? t('start.observerSuffix') : '' })}`);
  console.log(`  ${t('start.panel', { url })}`);
  if (isWildcardListenHost(host)) {
    console.log(`  ${t('start.listen', { host, port: actualPort })}`);
  }
  console.log(`  ${t('start.data', { dir })}`);
  console.log(`  ${t('start.logs', { dir: join(dir, 'logs') })}`);
  if (isObserver) {
    console.log(`  ${t('start.collectDesktop')}`);
  } else {
    console.log(`  ${t('start.hookState', { source: 'Claude', state: t(claudeHookOk ? 'common.active' : 'common.polling') })}`);
    console.log(`  ${t('start.hookState', { source: 'Codex', state: t(codexHookOk ? 'common.active' : 'common.polling') })}`);
  }
  console.log(`\n${t('start.ctrlC')}\n`);
}

async function cmdSync(source?: string): Promise<void> {
  // Reject unknown sources before touching config/log/lastSync state, so a
  // typo exits non-zero instead of refreshing "上次同步" with zero work done.
  const filter = resolveSyncSource(source, activeLocale);
  const { dir, config } = await loadConfig();
  await touchStatsSince(dir, config);
  const scope = filter ?? 'all';
  const started = Date.now();
  const logPath = syncLogPath(dir);

  await appendJsonLog(logPath, { event: 'start', source: scope });

  try {
    const results = await syncAll(dir, config, filter);
    await writeSyncDone(dir);
    await appendJsonLog(logPath, {
      event: 'done',
      source: scope,
      durationMs: Date.now() - started,
      results: results.map((r) => ({
        source: r.source,
        eventsParsed: r.eventsParsed,
        bucketsWritten: r.bucketsWritten,
        filesProcessed: r.filesProcessed,
        ...(r.skipped ? { skipped: true } : {}),
        ...(r.error ? { error: r.error } : {}),
      })),
    });
    for (const r of results) {
      if (r.skipped) {
        console.log(t('sync.skipped', { source: r.source }));
        continue;
      }
      console.log(t('sync.result', { source: r.source, messages: count(r.eventsParsed), buckets: count(r.bucketsWritten), files: count(r.filesProcessed) }));
    }
  } catch (err) {
    await appendJsonLog(logPath, {
      event: 'error',
      source: scope,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function cmdStatus(): Promise<void> {
  const { dir, config } = await loadConfig();
  const hooks = await getHookStatus(dir);
  const owner = await getRunningOwner(dir);
  const panelUp = server != null;
  const port = config.serverPort || DEFAULT_PORT;
  const host = config.serverHost || DEFAULT_HOST;

  if (owner != null) {
    console.log(t('status.owner', { kind: runtimeLabel(owner.kind), pid: owner.pid }));
  } else {
    console.log(t('status.runtime', { state: t('common.stopped') }));
  }
  if (panelUp) {
    console.log(t('status.localPanel', { observer: runtimeRole === 'observer' ? t('status.observerSuffix') : '' }));
  }
  console.log(t('start.panel', { url: formatListenUrl(host, port) }));
  console.log(t('status.dataDir', { dir }));
  console.log(t('start.device', { uuid: config.deviceId }));
  console.log(t('status.statsSince', { date: displayDate(config.statsSince) }));
  console.log(t('status.lastSync', { date: displayDate(config.lastSyncAt) }));
  console.log(t('start.hookState', { source: 'Claude', state: t(hooks.claude ? 'common.active' : 'common.polling') }));
  console.log(t('start.hookState', { source: 'Codex', state: t(hooks.codex ? 'common.active' : 'common.polling') }));
  console.log(t('status.cursor'));
  console.log(t('start.logs', { dir: join(dir, 'logs') }));
}

async function cmdDoctor(port?: number): Promise<void> {
  const report = await runDoctorDiagnostics({ port });
  printDoctorReport(report, activeLocale);
}

async function cmdStop(): Promise<void> {
  quotaRuntime?.dispose();
  quotaRuntime = null;
  if (pricingRefreshStop) {
    pricingRefreshStop();
    pricingRefreshStop = null;
  }
  if (syncWatcherStop) {
    syncWatcherStop();
    syncWatcherStop = null;
  }
  runSyncFn = null;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  const wasObserver = runtimeRole === 'observer';
  if (ownedPid && runtimeDataDir) {
    await releaseRuntimeOwner(runtimeDataDir);
  }
  ownedPid = false;
  runtimeDataDir = null;
  runtime = null;
  runtimeRole = 'owner';
  console.log(t(wasObserver ? 'stop.observer' : 'stop.service'));
}

async function cmdService(
  action: string | undefined,
  daysAgo?: number,
  listen?: { port?: number; host?: string },
): Promise<void> {
  const cliBinPath = resolveCliBinPath();
  switch (action) {
    case 'start':
      await cmdServiceStart(cliBinPath, daysAgo, listen, activeLocale);
      break;
    case 'stop':
      await cmdServiceStop(activeLocale);
      break;
    case 'status':
      await cmdServiceStatus(activeLocale);
      break;
    default:
      console.error(t('arg.serviceUsage'));
      process.exit(1);
  }
}

async function main(): Promise<void> {
  activeLocale = previewCliLocale(process.argv.slice(2));
  try {
    // Query before the runtime argument path: no startup, ownership or sync.
    const commandLine = extractCliLanguage(process.argv.slice(2));
    if (commandLine.args[0] === 'statusline') {
      await runStatusline(commandLine.args.slice(1), commandLine.lang ?? activeLocale);
      return;
    }
    if (commandLine.args[0] === 'usage') {
      const parsed = parseUsageArgs([
        ...commandLine.args.slice(1),
        ...(commandLine.lang ? ['--lang', commandLine.lang] : []),
      ]);
      activeLocale = parsed.lang ?? activeLocale;
      if (parsed.help) { printHelp(activeLocale); return; }
      const report = await readUsageReport(parsed.dataDir ? resolve(parsed.dataDir) : resolveDataDir(), parsed.query);
      console.log(formatUsageReport(report, parsed.format, { compact: parsed.compact, locale: activeLocale }));
      return;
    }
    const { command, serviceAction, port, host, source, days, lang } = parseArgs(process.argv);
    activeLocale = lang ?? activeLocale;
    const daysAgo = resolveDaysAgo(days, activeLocale);
    switch (command) {
      case 'help':
        printHelp(activeLocale);
        break;
      case 'start':
        await cmdStart(port, host, daysAgo);
        break;
      case 'sync':
        await cmdSync(source);
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'doctor':
        await cmdDoctor(port);
        break;
      case 'stop':
        await cmdStop();
        break;
      case 'service':
        await cmdService(serviceAction, daysAgo, { port, host });
        break;
      default:
        console.error(t('arg.unknownCommand', { value: command }));
        console.error(t('arg.helpHint'));
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof CliUserError) console.error(err.message);
    else {
      console.error(t('common.failed'));
      diagnosticDetail(err);
    }
    process.exit(1);
  }
}

async function shutdownFromSignal(): Promise<void> {
  await cmdStop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdownFromSignal();
});
process.on('SIGTERM', () => {
  void shutdownFromSignal();
});

if (process.env.QUOTERN_DEV_ISOLATED === '1' && process.send) {
  process.on('message', (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'quotern-dev-stop') {
      // Keep the parent alive after cleanup so the supervisor can terminate its
      // owned tree on Windows, including any remaining native helper processes.
      void cmdStop().then(() => process.send?.({ type: 'quotern-dev-stopped' }));
    }
  });
}

main();
