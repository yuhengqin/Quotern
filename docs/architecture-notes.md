# 架构注意事项

项目在本机采集 Coding Agent 用量，以 Core 统一解析、存储和计算，由 CLI 浏览器面板或 Electron 桌面端展示。修改功能时，先确定数据归属和运行进程，再选择实现入口。

相关说明：[数据采集与统计](./data-notes.md)、[运行维护](./runtime-notes.md)、[开发协作](./development-notes.md)。

## 模块职责

| 路径 | 职责 | 修改时注意 |
| --- | --- | --- |
| `packages/core` | 数据源发现、parser、queue、sync、定价、聚合与 local-api | 统计规则放在这里，避免各端自行解释同一字段 |
| `packages/cli` | 命令解析、后台服务、HTTP 与 Dashboard 静态资源托管 | CLI 构建依赖 Core 和 Dashboard；服务注册与进程运行是两个状态 |
| `packages/dashboard` | 浏览器面板，构建后随 CLI 分发 | 开发请求代理到本机 CLI，发布构建默认使用根路径 |
| `apps/desktop/src/main` | 窗口、IPC、运行时管理、订阅额度与更新 | 采集通常委派给 utilityProcess，主进程应用结果并提供读数 |
| `apps/desktop/src/preload` | `window.tud` 桥接 | 只暴露明确的方法及必要的返回数据 |
| `apps/desktop/src/renderer` | 桌面主窗口和托盘面板 | 与 Dashboard 同构但独立，存在需要同步修改的同名文件 |

两份 UI 的 transport 不同。浏览器通过 HTTP，桌面端优先通过 `window.tud.api.request` 调用主进程中的 Hono app。不要整目录复制 `api.ts`；共享字段含义和展示逻辑时，保留各自的 transport 和恢复处理。

## 数据流

```text
Agent 日志或数据库 / 需要登录状态的数据源
  → parser：增量读取、来源归一化、去重
  → sync：合并或替换统计桶，写入 queue 和 cursors
  → BucketStore + AggregateCache：本机统计与历史日缓存
  → local-api
      ├─ CLI HTTP → Dashboard
      └─ Desktop IPC → Renderer / 托盘
```

订阅额度走另一条链路：`packages/core/src/quota` 读取 Agent 登录状态或调用 Agent CLI / 官方额度接口，由 `QuotaManager` 统一调度、保存有效历史。CLI 经 `/functions/tud-quota` HTTP 提供查询、刷新及偏好操作；Desktop 经 `quota` IPC 向主窗口、托盘与宠物提供状态，并负责系统通知。两端共用卡片和详情展示，保留各自的额度历史目录。额度余额不能当作已采集 Token 总量。适配规则见[订阅数据说明](./subscription-plan-design.md)，刷新、通知和历史口径见[额度管理](./quota-management.md)。

## 本地接口

路由定义以 [local-api.ts](../packages/core/src/server/local-api.ts) 为准。CLI 默认监听 `127.0.0.1:8452`；Desktop 直接调用内存 app，不监听该端口。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | HTTP 就绪检查，返回 `{ ok: true }` |
| `GET /functions/tud-usage-summary` | 本机汇总；`tud-account-usage-summary` 是同处理函数的另一入口 |
| `GET /functions/tud-usage-daily` | 按日统计，默认 90 天 |
| `GET /functions/tud-usage-hourly` | 按小时展示，默认 1 天 |
| `GET /functions/tud-usage-model-breakdown` | 模型与项目分布，默认 30 天 |
| `GET /functions/tud-usage-report` | 只读报表与费用依据；`period=summary\|overview\|daily\|weekly\|monthly\|models\|projects`，默认 `summary` / 7 天；支持 `days` 或成对 `fromDate/toDate`，可按 `sources`（逗号分隔）、`model`、`project` 筛选；拒绝未知、重复参数 |
| 上述三个统计端点的日期参数 | 可同时传 `fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`，按北京时间包含两端；无参数时保留 `days` 语义，缺一端、无效日期、倒序或未来日期返回 400 |
| `GET /functions/tud-sync-status` | 同步时间、来源和 Hook 状态 |
| `GET /functions/tud-config` | 设备标识、统计下限、采集下限、最近同步时间 |
| `POST /functions/tud-trigger-sync` | 可传 `{ source }`；省略或 `all` 为全量，未知来源返回 400 |
| `POST /functions/tud-ensure-local-range` | 可传 `{ days }`；支持 1、7、30、90；自定义范围传 `{ days, custom: true }`，支持 1–365 的整数，按需扩展采集范围 |
| `GET /functions/tud-share-backgrounds` | 读取本机共享背景图库，返回图片 Data URL 和元数据 |
| `POST /functions/tud-share-backgrounds` | `operation` 为 `add` / `remove` / `touch` / `import`；导入返回图库、已接收与待导入旧 ID，满额不自动覆盖 |

统计接口成功时返回 `{ success: true, message: 'ok', data }`，已处理的参数错误返回 `{ success: false, message, data: null }`。调用方同时处理 HTTP 错误、非 JSON 响应和业务状态；`trigger-sync` 的 `data.ok` 还表示实际同步结果，不能只检查外层 `success`。

桌面 runtime 暂未就绪时，IPC 可返回 503 / `LOCAL_RUNTIME_NOT_READY`。Renderer 的 [api.ts](../apps/desktop/src/renderer/lib/api.ts) 每 500 毫秒重试，最多等待 20 秒。新增入口应沿用现有 transport，不在组件中另建轮询或直接访问文件。

## 数据目录与文件归属

默认数据目录由 [paths.ts](../packages/core/src/paths.ts) 定义为用户主目录下的 `.quotern`。

| 文件 | 作用 |
| --- | --- |
| `config.json` | 本机配置，所有写入经过 Core 配置锁 |
| `cursors.json` | 文件偏移、去重集合、累计水位等增量状态 |
| `queue/YYYY-MM.jsonl` | 按 UTC 月分文件的统计桶版本记录 |
| `queue/manifest.json` | 队列月份与时间范围索引 |
| `cache/daily-sealed.json` | 已结束日期的聚合缓存 |
| `pricing-overlay.json` | 最近成功获取的价格覆盖表 |
| `tud.pid`、`tud.heartbeat` | runtime owner 与存活状态 |
| `notify.signal`、`sync.done` | Hook 唤醒与同步完成信号 |
| `bin/notify.sh` 或 `bin/notify.cmd`、`bin/notify.ps1` | 平台对应的 Hook 信号脚本 |
| `logs/` | 同步、通知与后台服务排障日志 |
| `share-backgrounds/` | Core 管理的共享背景图片及 `index.json`；独立文件锁协调 CLI、Desktop 多进程访问，备份须复制完整目录 |

设备标识还有独立 sidecar：Windows 使用 `%APPDATA%/quotern/device-id`，其他平台使用 `$XDG_CONFIG_HOME/quotern/device-id`，未设置时使用 `~/.config/quotern/device-id`。可用 `QUOTERN_CONFIG_HOME` 覆盖配置目录。仅清理统计数据目录不会生成新的设备身份。从旧目录升级时，应先按[状态迁移步骤](runtime-notes.md#升级前迁移状态)复制设备身份和 Desktop 设置；运行时只使用 Quotern 目录。

## 网络与数据边界

统计桶包含来源、模型、项目归属和 Token 等数值。部分 parser 为计算用量需要读取 Agent 会话文件；持久化统计桶的结构以 [QueueBucket](../packages/core/src/types.ts) 为准，不应把原始对话或认证材料扩展进该结构。

运行时仍可能访问网络：Cursor 账单采集、价格覆盖表、供应商订阅额度与公开服务状态、桌面更新和安装包下载各有独立入口。修改网络行为时，应同时检查调用目的、目标地址、超时、账号隔离和失败降级；不能从“本机统计”推断所有数据源都能离线取得最新读数。

## 修改入口

- 统计与价格口径：先看 [data-notes.md](./data-notes.md)，改 Core 及对应测试，再核对两份面板。
- 采集进程、启动或退出：先看 [runtime-notes.md](./runtime-notes.md)，核对 owner、worker、窗口与更新的先后顺序。
- 订阅卡：一起检查主进程 reader、shared 类型、preload、renderer 和账号缓存。
- 打包或依赖：按 [development-notes.md](./development-notes.md) 验证消费该包的入口，发版另见 [RELEASE.md](../RELEASE.md)。
