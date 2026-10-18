import { access, constants, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';

import {
  loadConfig,
} from './config.js';
import {
  resolveDataDir,
  DEFAULT_PORT,
  cursorsPath,
  logsDir as resolveLogsDir,
} from './paths.js';
import {
  clearPid,
  isStillSameRuntimeProcess,
  pidFilePath,
  readRuntimeOwner,
  runtimeKindLabel,
} from './runtime-pid.js';
import { getHookStatus } from './server/state.js';
import { SYNC_SOURCE_IDS } from './sync/index.js';
import { isSyncSourcePresent } from './sync/source-presence.js';
import { TOOL_CATALOG } from './tool-catalog.js';
import type { TudConfig } from './types.js';

export type DoctorStatus = 'ok' | 'warn' | 'error' | 'info';

export interface DoctorCheckItem {
  id: string;
  name: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
  suggestion?: string;
}

export interface DoctorCollectorItem {
  key: string;
  displayName: string;
  present: boolean;
  hookStatus?: 'active' | 'inactive';
  detail?: string;
}

export interface DoctorCategory {
  id: string;
  title: string;
  status: DoctorStatus;
  items: DoctorCheckItem[];
}

export interface DoctorReport {
  timestamp: string;
  categories: DoctorCategory[];
  collectors: {
    total: number;
    detected: number;
    items: DoctorCollectorItem[];
  };
  summary: {
    status: DoctorStatus;
    okCount: number;
    warnCount: number;
    errorCount: number;
    suggestions: string[];
  };
}

export interface RunDoctorOptions {
  dataDir?: string;
  config?: TudConfig;
  port?: number;
  skipNetworkProbe?: boolean;
}

/** Sync channel id → TOOL_CATALOG key when the two registries disagree. */
const SYNC_ID_TO_CATALOG_KEY: Record<string, string> = {
  claude: 'claude-code',
  qwen: 'qwen-code',
};

/** Display names for sync sources that are not in TOOL_CATALOG. */
const SYNC_ID_DISPLAY_FALLBACK: Record<string, string> = {
  qwenwork: 'QwenWork',
};

function collectorDisplayName(sourceId: string): string {
  const catalogKey = SYNC_ID_TO_CATALOG_KEY[sourceId] ?? sourceId;
  const tool = TOOL_CATALOG.find((item) => item.key === catalogKey);
  return tool?.displayName ?? SYNC_ID_DISPLAY_FALLBACK[sourceId] ?? sourceId;
}

function formatDeleteCommand(target: string): string {
  if (process.platform === 'win32') {
    return `Remove-Item -Force "${target}"`;
  }
  return `rm "${target}"`;
}

function formatWritableHint(target: string): string {
  if (process.platform === 'win32') {
    return `请检查该路径是否可写: ${target}`;
  }
  return `请检查读写权限: chmod -R u+rw "${target}"`;
}

function fallbackConfig(dataDir: string): TudConfig {
  return {
    deviceId: 'unknown',
    hostname: 'localhost',
    dataDir,
    statsSince: new Date().toISOString(),
    serverPort: DEFAULT_PORT,
  };
}

/** Check TCP port accessibility */
function checkPortOpen(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

/** Probe network endpoint reachability and latency */
function resolveCategoryStatus(items: DoctorCheckItem[]): DoctorStatus {
  if (items.some((i) => i.status === 'error')) return 'error';
  if (items.some((i) => i.status === 'warn')) return 'warn';
  return 'ok';
}

function rememberSuggestion(suggestions: string[], item: DoctorCheckItem): void {
  if (item.suggestion) suggestions.push(item.suggestion);
}

export async function runDoctorDiagnostics(
  options: RunDoctorOptions = {},
): Promise<DoctorReport> {
  let dataDir = resolveDataDir(options.dataDir);
  let config: TudConfig;
  let configError: string | null = null;
  let recoveredBackupPath: string | null = null;

  try {
    if (options.config) {
      config = options.config;
    } else {
      const loaded = await loadConfig(dataDir);
      dataDir = loaded.dir;
      config = loaded.config;
      if (loaded.recoveredFromCorrupt) {
        recoveredBackupPath = loaded.recoveredFromCorrupt.backupPath;
      }
    }
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
    config = fallbackConfig(dataDir);
  }

  const port = options.port ?? config.serverPort ?? DEFAULT_PORT;
  const categories: DoctorCategory[] = [];
  const suggestions: string[] = [];

  // ==========================================
  // 1. Runtime & Process
  // ==========================================
  const runtimeItems: DoctorCheckItem[] = [];

  // Node.js version
  const nodeVer = process.versions.node;
  const majorNodeVer = parseInt(nodeVer.split('.')[0] ?? '0', 10);
  if (majorNodeVer >= 20) {
    runtimeItems.push({
      id: 'runtime-node',
      name: 'Node.js 版本',
      status: 'ok',
      message: `v${nodeVer} (符合 >= 20 要求)`,
    });
  } else {
    const item: DoctorCheckItem = {
      id: 'runtime-node',
      name: 'Node.js 版本',
      status: 'error',
      message: `当前版本 v${nodeVer} 低于要求 (需要 Node.js >= 20)`,
      suggestion: '请升级 Node.js 到 20 或更高版本以保证功能正常运行。',
    };
    runtimeItems.push(item);
    rememberSuggestion(suggestions, item);
  }

  // OS & Platform
  runtimeItems.push({
    id: 'runtime-os',
    name: '操作系统',
    status: 'ok',
    message: `${process.platform} (${process.arch})`,
  });

  // PID lock: same liveness rules as runtime. Stale/unreadable files are
  // removed here (getRunningOwner would also clear them on next start).
  const pidFile = pidFilePath(dataDir);
  const pidExists = existsSync(pidFile);
  const owner = await readRuntimeOwner(dataDir);

  if (owner && isStillSameRuntimeProcess(owner)) {
    runtimeItems.push({
      id: 'runtime-pid',
      name: '服务进程锁',
      status: 'ok',
      message: `${runtimeKindLabel(owner.kind)} 正在运行 (PID: ${owner.pid}, 角色: owner)`,
    });
  } else if (pidExists) {
    await clearPid(dataDir);
    if (existsSync(pidFile)) {
      const item: DoctorCheckItem = {
        id: 'runtime-pid',
        name: '服务进程锁',
        status: 'warn',
        message: owner
          ? `检测到失效的锁文件 (PID: ${owner.pid} 已无响应)，但自动清理失败`
          : '存在未识别格式的 tud.pid 文件，但自动清理失败',
        detail: `锁文件路径: ${pidFile}`,
        suggestion: `请手动删除陈旧的锁文件: ${formatDeleteCommand(pidFile)}`,
      };
      runtimeItems.push(item);
      rememberSuggestion(suggestions, item);
    } else {
      runtimeItems.push({
        id: 'runtime-pid',
        name: '服务进程锁',
        status: 'info',
        message: owner
          ? `已清理失效的锁文件 (原 PID: ${owner.pid})`
          : '已清理无法识别的 tud.pid 文件',
        detail: `原路径: ${pidFile}`,
      });
    }
  } else {
    runtimeItems.push({
      id: 'runtime-pid',
      name: '服务进程锁',
      status: 'info',
      message: '当前无常驻主服务在运行 (空闲状态)',
    });
  }

  // Local port probe
  const portOpen = await checkPortOpen(port);
  if (portOpen) {
    runtimeItems.push({
      id: 'runtime-port',
      name: '面板端口',
      status: 'ok',
      message: `端口 ${port} 正在监听服务 (http://127.0.0.1:${port})`,
    });
  } else {
    runtimeItems.push({
      id: 'runtime-port',
      name: '面板端口',
      status: 'info',
      message: `端口 ${port} 未处于监听状态 (可通过 quotern start 启动)`,
    });
  }

  categories.push({
    id: 'runtime',
    title: '运行环境与进程状态',
    status: resolveCategoryStatus(runtimeItems),
    items: runtimeItems,
  });

  // ==========================================
  // 2. Storage & Permissions
  // ==========================================
  const storageItems: DoctorCheckItem[] = [];

  // Data dir permissions
  try {
    await access(dataDir, constants.R_OK | constants.W_OK);
    storageItems.push({
      id: 'storage-datadir',
      name: '数据目录',
      status: 'ok',
      message: `${dataDir} (读写正常)`,
    });
  } catch (err) {
    const item: DoctorCheckItem = {
      id: 'storage-datadir',
      name: '数据目录',
      status: 'error',
      message: `${dataDir} 访问受限`,
      detail: err instanceof Error ? err.message : String(err),
      suggestion: formatWritableHint(dataDir),
    };
    storageItems.push(item);
    rememberSuggestion(suggestions, item);
  }

  // Config file
  if (configError) {
    const item: DoctorCheckItem = {
      id: 'storage-config',
      name: '配置文件',
      status: 'error',
      message: 'config.json 无法加载',
      detail: configError,
      suggestion: '请检查数据目录权限，或备份后删除损坏的 config.json 后重新启动。',
    };
    storageItems.push(item);
    rememberSuggestion(suggestions, item);
  } else if (recoveredBackupPath) {
    const item: DoctorCheckItem = {
      id: 'storage-config',
      name: '配置文件',
      status: 'warn',
      message: 'config.json 曾损坏，已自动恢复',
      detail: `备份文件: ${recoveredBackupPath}`,
      suggestion: '请检查本地配置是否仍有效；确认无误后可删除备份文件。',
    };
    storageItems.push(item);
    rememberSuggestion(suggestions, item);
  } else {
    storageItems.push({
      id: 'storage-config',
      name: '配置文件',
      status: 'ok',
      message: `有效 (设备 UUID: ${config.deviceId})`,
    });
  }

  // Logs directory
  const logsDir = resolveLogsDir(dataDir);
  try {
    if (existsSync(logsDir)) {
      await access(logsDir, constants.R_OK | constants.W_OK);
      storageItems.push({
        id: 'storage-logs',
        name: '日志目录',
        status: 'ok',
        message: `${logsDir} (可正常写入)`,
      });
    } else {
      storageItems.push({
        id: 'storage-logs',
        name: '日志目录',
        status: 'info',
        message: `${logsDir} 尚未创建 (将在首次启动时初始化)`,
      });
    }
  } catch (err) {
    const item: DoctorCheckItem = {
      id: 'storage-logs',
      name: '日志目录',
      status: 'warn',
      message: `${logsDir} 权限异常`,
      detail: err instanceof Error ? err.message : String(err),
      suggestion: formatWritableHint(logsDir),
    };
    storageItems.push(item);
    rememberSuggestion(suggestions, item);
  }

  const cursorsFile = cursorsPath(dataDir);
  if (existsSync(cursorsFile)) {
    try {
      const content = await readFile(cursorsFile, 'utf-8');
      const cursors = JSON.parse(content) as Record<string, unknown>;
      const trackedSources = Object.keys(cursors).length;
      storageItems.push({
        id: 'storage-cursors',
        name: '同步游标',
        status: 'ok',
        message: `游标记录完好 (已记录 ${trackedSources} 个数据源的同步状态)`,
      });
    } catch {
      const item: DoctorCheckItem = {
        id: 'storage-cursors',
        name: '同步游标',
        status: 'warn',
        message: 'cursors.json 解析失败',
        suggestion: '游标文件格式异常，可运行 quotern sync 进行自动修复。',
      };
      storageItems.push(item);
      rememberSuggestion(suggestions, item);
    }
  } else {
    storageItems.push({
      id: 'storage-cursors',
      name: '同步游标',
      status: 'info',
      message: '尚未产生同步游标记录 (将在首次数据同步后生成)',
    });
  }

  categories.push({
    id: 'storage',
    title: '数据存储与权限',
    status: resolveCategoryStatus(storageItems),
    items: storageItems,
  });

  // ==========================================
  // 3. AI Collectors & Tools
  // ==========================================
  let hookStatus: { claude: boolean; codex: boolean } = { claude: false, codex: false };
  try {
    hookStatus = await getHookStatus(dataDir);
  } catch {
    // ignore hook check failure
  }

  const collectorItems: DoctorCollectorItem[] = [];
  for (const sourceId of SYNC_SOURCE_IDS) {
    const present = isSyncSourcePresent(sourceId);
    let hook: 'active' | 'inactive' | undefined;
    if (sourceId === 'claude') {
      hook = hookStatus.claude ? 'active' : 'inactive';
    } else if (sourceId === 'codex') {
      hook = hookStatus.codex ? 'active' : 'inactive';
    }
    collectorItems.push({
      key: sourceId,
      displayName: collectorDisplayName(sourceId),
      present,
      hookStatus: hook,
    });
  }

  const detectedCollectors = collectorItems.filter((c) => c.present);
  const toolCheckItems: DoctorCheckItem[] = [];

  if (detectedCollectors.length > 0) {
    toolCheckItems.push({
      id: 'collectors-summary',
      name: '已探测 Agent',
      status: 'ok',
      message: `检测到 ${detectedCollectors.length} 款 Coding Agent 存在本地有效数据源`,
      detail: detectedCollectors
        .map((c) => `${c.displayName}${c.hookStatus ? ` (Hook: ${c.hookStatus})` : ''}`)
        .join(', '),
    });
  } else {
    const item: DoctorCheckItem = {
      id: 'collectors-summary',
      name: '已探测 Agent',
      status: 'warn',
      message: '未在系统中检测到任何支持的 Agent 日志或数据库',
      suggestion:
        '请确认是否已使用过支持的 Agent（如 Cursor、Claude Code、Codex、Trae 等）并产生过对话用量。',
    };
    toolCheckItems.push(item);
    rememberSuggestion(suggestions, item);
  }

  categories.push({
    id: 'collectors',
    title: `本地 Agent 与数据源 (已检测到 ${detectedCollectors.length} / ${collectorItems.length} 款)`,
    status: resolveCategoryStatus(toolCheckItems),
    items: toolCheckItems,
  });

  let okCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  for (const cat of categories) {
    for (const item of cat.items) {
      if (item.status === 'ok') okCount++;
      else if (item.status === 'warn') warnCount++;
      else if (item.status === 'error') errorCount++;
    }
  }

  const overallStatus: DoctorStatus =
    errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok';

  return {
    timestamp: new Date().toISOString(),
    categories,
    collectors: {
      total: collectorItems.length,
      detected: detectedCollectors.length,
      items: collectorItems,
    },
    summary: {
      status: overallStatus,
      okCount,
      warnCount,
      errorCount,
      suggestions: Array.from(new Set(suggestions)),
    },
  };
}
