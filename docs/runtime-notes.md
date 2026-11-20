# 运行维护注意事项

排查启动、采集停滞、窗口恢复和更新问题时，先确认 runtime owner，再检查信号、worker 和缓存。避免把窗口是否可见当作采集进程是否运行的依据。

## Runtime owner 与 CLI 服务

只读演示 `quotern demo start --file <snapshot.json>` 是独立入口，默认监听 `127.0.0.1:8253`，不参与下述正常 runtime owner、Hook、采集、自启和额度调度。它可以与正常客户端并行；停止演示只关闭自己持有的 HTTP server。开发验收使用本 worktree 私有快照和独立端口，不用正常 `start` 代替演示入口。完整步骤见 [CLI 演示说明](../CLI.md#演示快照与只读面板)。

演示快照保留脱敏后的会话洞察证据、累计用量标记及估算计价依据；旧版 v1 快照缺少洞察证据时仍可读取，缺失指标保持未知。项目目录和自定义代理名称不发布，演示不提供恢复命令或本机目录操作，也不读取部署机器的上下文审计；普通 CLI/Desktop 的这些能力仍由原有接口提供。CSV 导出保持完整筛选结果，不受首页六条预览限制。

演示会话浏览页仅展示筛选后第一页的 12 条主会话，点击下一页显示演示提示；URL 中的其他页码和容量在请求前归一化。此展示限制不裁剪快照、查询 API 或 CSV 导出中的完整历史。

公网固定演示的 gzip、静态资源长期缓存与版本化 API 响应缓存见 [NGINX 演示部署配置](../deploy/demo/README.md)。该缓存例外只作用于演示站点；更新代码或快照必须更换缓存版本键，HTML 与 API 浏览器缓存不跨部署保留。

演示启动在监听端口前经同一套只读 API 预生成默认首页响应，仅注入 `/`、`/dashboard` 的 HTML；浏览器只复用快照元数据匹配且 URL 完全相同的 GET，其他范围、筛选和完整会话页照常请求 API。演示首页 `session-activity?days=7&preview=6` 只返回最近六条详情，但保留完整 Token/费用、会话总数和每个账单组的会话计数；定向查询和普通模式忽略预览参数。构建的 `demo-preload.json` 记录真实入口、Dashboard 及静态依赖，演示 HTML 提前发出资源提示；旧构建缺少清单时仍可加载。普通 CLI 和 Desktop 不注入预生成数据或资源提示。

正式运行统一使用 `~/.quotern/`，不提供其他目录名称的识别、自动迁移或兼容入口。隔离开发继续使用当前 worktree 的 `.quotern-dev/data`。

同一数据目录的常驻采集由一个 owner 管理，`tud.pid` 记录 `{ pid, kind }`。Desktop 启动时先处理 CLI 自启，再停止 CLI 并接管；macOS / Windows 有对应的 CLI 自启撤销实现。Linux 的撤销分支没有实现，不能据其他平台行为作保证。

Desktop 已运行时，另开 `quotern start` 会作为 observer 提供浏览器面板，通过同步完成信号刷新读数，不建立自己的常驻采集调度。`quotern service stop` 停止 CLI 服务时应保留 Desktop owner。

清理进程使用 [runtime-pid.ts](../packages/core/src/runtime-pid.ts) 与 [runtime-supervisor.ts](../packages/core/src/runtime-supervisor.ts) 的真实命令识别和会话保护。路径含仓库名的 VS Code / Cursor helper 并不等于本项目服务。Windows owner 探测优先使用 PowerShell CIM，不依赖 `wmic`。

证据：[runtime-pid 测试](../packages/core/test/runtime-pid.test.ts)、[CLI 服务实现](../packages/cli/src/service.ts)。

异步 owner 读取与写入使用非阻塞进程探测：Windows 一次 CIM 查询读取命令行和 UTC 启动时间，兼容 WMIC 回退；并发探测合并，外部进程的成功缓存仅保留两秒。自身 PID 与本进程已确认的启动标识一致时直接确认，不在每次 Desktop watchdog 中重复启动 PowerShell。公开同步 helper 继续供同步调用方使用。

## Hook 与后台轮询

价格重验证由 Core 独立句柄调度，默认 24h，与采集退避和 watchdog 分开。Desktop 在所有平台的 resume 事件中调用轻量过期检查，不重启 runtime、不启动采集；计时器与 resume 共用同一在途请求。停止/恢复会清理并替换句柄。实际变价后的历史重建先按日期分组，分组和逐日计算之间让出事件循环，并用重建代次拒绝旧快照；冷加载共享在途读取，持久化串行，后到的清空/重建不能被旧读盘恢复。只有当前 runtime 的完成回调可发布更新。自动检查仅修改来源/核实时间时不重建费用。

可选 Agent 行为 Hook 与现有采集 Hook 分开管理；配置、交接、Claude 插件和真实请求的边界见 [Agent 集成](agent-integrations.md)。`/functions/tud-agent` 要求本机请求，写操作还需要运行实例的动作 token；演示模式不注册此路由。自动开窗复用成功额度观测，但必须由当前 runtime owner 执行，开发隔离时禁用。

`/functions/tud-agent/activity` 只读返回有界的会话元数据观测；自动开窗等待原因与最近请求结果由 Agent 状态一起返回。账号提醒、离线 statusline 与活动入口的语义和验收见 [额度体验](quota-experience.md)。请求完成不等于额度窗口已确认开启，工具结果不等于任务成功。

Claude / Codex Hook 写入 `notify.signal`，常驻进程监听后调度同步。当前脚本为 POSIX 的 `notify.sh` 和 Windows 的 `notify.cmd` / `notify.ps1`，不需要在每次通知时启动 CLI。

后台轮询以 1 分钟为起点，同一档位连续 3 个空轮次后逐步退避到 2、5 分钟；下一轮在上一轮完成后安排。Cursor 后台拉取还有 5 分钟最小间隔，手动或 Hook 触发不按该后台间隔限制。数值见 [paths.ts](../packages/core/src/paths.ts)。

隔离开发入口主动跳过 Claude/Codex Hook 注册，并输出说明性日志；这不表示正式用户的 Hook 配置损坏。非隔离模式注册失败时仍输出警告并使用轮询。

排障先区分“没有新数据”“来源被跳过”和“来源报错”，结合 `logs/notify.log`、`logs/sync.log` 与面板同步状态判断。

## 采集 worker 与卡死恢复

Tauri 原生宿主管理窗口；Node sidecar 维护 BucketStore 和内存 local-api，并由捆绑 Node fork 同步 worker。worker 启动失败时的 sidecar 同步回退不具备进程隔离带来的响应性优势。

[sync-worker.ts](../apps/desktop/src/main/sync-worker.ts) 在独立 worker thread 中维护看门狗。同步进程每 30 秒喂活，连续 5 分钟无法调度时终止该进程，由宿主恢复。把超时器放在已经卡死的事件循环内不能解决这个问题。

[sync-worker-host.ts](../apps/desktop/src/main/sync-worker-host.ts) 在完成一个同步结果或返回同步错误后清零崩溃次数，不在收到 `ready` 时清零。退出事件触发的连续自动重启最多 5 次；后续同步请求仍可能重新启动 worker，因此这不是永久停机开关。

worker 的启动请求合并，每代进程仅处理自己的消息与等待请求；替换、停止及同步超时会确认旧进程退出，避免并行写入。异常退出记录 PID、退出码、等待请求数和重启计数；V8 fatal error 另记录类型与位置。worker 记录最后请求、看门狗触发和致命异常调用栈。

一轮采集中已落盘但尚未回传的增量，在失败后先通过磁盘刷新 BucketStore 和聚合缓存恢复；恢复失败时，下一轮先重试恢复。正常轮次继续只应用增量，不每轮全量重读。该恢复不提供 queue 与 cursor 跨文件写入在任意崩溃时刻的事务保证。

原生 SIGTRAP 应保持致命信号语义，普通 SIGTERM / SIGINT / exit 清理监听继续保留，见 [native-crash-signals.ts](../apps/desktop/src/main/native-crash-signals.ts) 及[对应测试](../apps/desktop/src/main/native-crash-signals.test.ts)。

### 会话分析与窗口响应

Desktop 的 `/functions/tud-session-activity`、`tud-session-list`、`tud-session-detail`、`tud-performance`、`tud-usage-sessions` 仅 GET 经捆绑 Node fork 的独立分析进程执行。该进程复用同一 Core local-api，按顺序应用 sidecar 当前 BucketStore、有效采集起点、配置、分层价格和账号标签快照，再处理查询。桶与价格只在版本变化时重传；session-only 写入仍经磁盘快照版本检查发现，不依赖 bucket revision。

Core 在一次洞察分析中共享派发索引；同范围在途构建与已完成 hydration 复用，返回对象单独复制，防止 API 筛选、调用方修改和账号标签污染缓存。范围、桶、历史或价格变化后失效；会话标题与账号标签继续读取当前值。

历史缓存以内部弱引用关联来源代次；来源替换、删除、损坏或成功写入后，释放所有引用旧代次的历史组合与查询范围。桶、采集起点或价格变更也释放旧范围。容量淘汰只取消缓存资格，不使本次已读数据无效；连续版本变化最多在同一查询内重读三次，仍无法取得有效快照时返回 `503` / `SESSION_HISTORY_CHANGED` 标准 JSON 错误，下一次请求可以恢复。不能在同 key 的 pending 查询中重新等待自身。

分析进程按需启动，启动最多等待 15 秒、单次请求最多 30 秒；故障/超时拒绝所属请求并回收，后续请求可重建，绝不静默回退 sidecar 分析。停止 runtime 同时回收同步与分析进程。诊断时按 PID 区分 Tauri 宿主、Node sidecar、同步与分析进程；`logs/sync.log` 中 `cpu_phase/session_query` 的 `role=session-analysis`、route、status、wallMs 与 cpuMs 标识真实查询耗时。

## 卡顿排查与回归验收

架构边界以 [Desktop 响应性约束](architecture-notes.md#desktop-响应性约束) 为准；此处保留可执行的排查顺序和历史线索。

1. 记录实际启动入口、checkout/commit、数据目录及各进程 PID。先区分接口等待、renderer 长任务、Tauri 宿主或 Node sidecar 阻塞和 Windows 原生输入问题；CLI 网页流畅只能说明另一条执行路径仍可交互。
2. 结合操作时间、CPU profile 和日志定位热点。按 PID 区分主进程、采集与分析进程，不仅依赖日志的 `role` 字段：历史采集日志中的 `role=main` 也可能属于采集子进程。记录最长连续任务和对应调用链，避免把整个异步请求的 wallMs 当成窗口线程阻塞时间。
3. 性能相关修改使用代表性历史数据或足够规模的合成数据。覆盖冷加载、重复相同查询、至少一轮受影响的周期刷新、聚焦/同步后重验证，并在加载期间操作设置或菜单。对照改前改后结果、主进程采样与窗口响应；测试夹具的小数据集不能单独证明大历史下流畅。
4. 按变更覆盖缓存失效、标题删除、价格更新、附加账号及查询期间账号切换；进程层覆盖启动共享、超时/崩溃、停止中请求、等待冷启动后才恢复的旧请求和退出回收。会话/进程相关回归分别见 [Core 查询测试](../packages/core/test/session-query-api.test.ts)、[归属测试](../packages/core/test/runtime-pid.test.ts)、[分析宿主测试](../apps/desktop/src/main/session-analysis-host.test.ts) 和 [runtime 生命周期测试](../apps/desktop/src/main/local-runtime-lifecycle.test.ts)。
5. 交付时记录测试与实际运行证据各自覆盖的范围；构建和单测不能替代 Tauri Desktop 实测。可运行 `node apps/desktop/scripts/tauri-webview-smoke.mjs [built host]` 检查真实 WebView 和基础桥接，但不能以小夹具代替代表性数据验收。私有原始 profile、日志和合成产物留在所属隔离目录，文档只保留脱敏结论及可重定位线索；按服务归属规则退出本次实例。安装包、多屏或其他系统未实测时明确标注范围。

价格专项的旧 Electron 脚本 `node apps/desktop/scripts/run-pricing-sources-smoke.mjs [全新输出目录]` 使用合成历史及 30,000 桶/100 日的重算夹具；其结果不代表当前 Tauri Desktop 通过。对应变更仍需以不低于该数据规模的真实宿主验收，覆盖来源、核实日期、旧价、四语言、键盘、窄屏和重算时响应性；系统真实休眠/恢复及其他平台另行实测。

反复出现的问题属于不同机制，排查时核对对应修复是否仍在实际执行路径中：

| 日期 / Git 线索 | 已处理的风险与后续核对点 |
| --- | --- |
| 2026-10-19 `efa2ff0b`、2026-10-22 `56c532e2` | 两种桌宠的 Windows 全局鼠标转发风险；同时检查内置实现与生成 helper，不能只核对其中一端。原验收边界见 [Windows 独立宠物记录](superpowers/dsh-pet-validation.md)。 |
| 2026-10-21 `168da1eb` | 采集 worker 的并发启动、旧代事件、退出确认与磁盘恢复；采集隔离存在不代表所有 API 计算都已离开主进程。 |
| 2026-11-13 `5abdb300` | 逐会话全量证据扫描、重复洞察计算、主进程重查询及周期性同步 PowerShell 探测；设计与当次 Windows 45 秒采样证据见 [响应性修复记录](superpowers/specs/2026-11-13-desktop-responsiveness-design.md#windows-验收记录2026-11-13)。 |

## 窗口与桥接初始化

Tauri 宿主 `apps/desktop/src-tauri/src/main.rs` 管理窗口；renderer 通过 `src/preload/index.ts` 和 `tauri-transport.ts` 与 Node sidecar 通信。验证启动、关闭与恢复时按实际宿主和进程分别记录，不以旧 Electron 窗口测试代替。

## 发版与更新

使用根 `package.json` 的 `release:desktop` 命令并遵循 [RELEASE.md](../RELEASE.md) 的发版步骤；旧 Electron 更新实现及验收记录不能证明当前 Tauri 更新能力。各平台安装包和更新流程须独立验证。

## 宠物导入与失败日志

旧版 Windows Desktop 的宠物下载曾使用 Electron `net.fetch` 和系统代理；迁移后应核对当前下载路径。请求不得携带会话凭据，超时应覆盖响应流读取，压缩包与解压后文件继续受大小和目录校验限制。

内置角色 ID 保留给内置实现。ZIP、链接和本地 Codex 导入遇到 ID 冲突时，使用 `原ID-imported-内容摘要` 形式的独立 ID（必要时截短原 ID 并加序号），不覆盖原目录或修改 Codex 的源文件。相同内容重复导入会复用已安装角色，保留原有的预览、应用和移除行为。

宠物目录操作的 IPC 失败写入当前数据目录的 `logs/pet-import.log`：正式运行位于 `~/.quotern/logs/`，隔离开发位于当前 worktree 的 `.quotern-dev/data/logs/`。JSONL 条目包含 `ts`、`action`、`phase`、分类 `code`、底层 `diagnosticCode`、错误类型、安全的角色 ID，以及适用时的 HTTP 状态；不记录完整 URL、请求头、原始异常文本或本地文件路径。`phase` 区分 `url/download/archive/validation/install`，其他目录操作失败使用 `catalog`；例如 `ENOTFOUND` 是 DNS 解析失败，`ERR_PROXY_CONNECTION_FAILED` 是代理连接失败。日志沿用 1 MB 轮转及一个 `.1` 备份；写日志失败不会使宠物操作再次失败，取消选择 ZIP 不记失败。

## 自启注册与恢复

- Linux：需要 systemd 用户实例；unit 文件存在不代表 enabled。写入、reload 或 enable 失败要撤销残留，见 [service-linux.ts](../packages/cli/src/service-linux.ts)。
- Windows：首次注册计划任务失败会导致 `service start` 失败；已有服务运行时补注册失败仅警告。可在管理员终端注册，或用 `quotern start` 前台运行。
- 持久化后台启动命令时使用真实 Node 和 CLI 路径，避免保存只在当前 fnm / nvm 会话有效的 shim。

用户排障顺序见 [FAQ](../FAQ.md)。检查 PID 对应进程并退出后再处理残留文件；不要仅按名称批量终止开发工具或直接删除整个数据目录。

## 本地备份恢复

使用步骤和容量边界见 [CLI 本地备份与恢复](../CLI.md#本地备份与恢复)。数据事务锁覆盖采集、配置/游标和相关状态写入；快照还进行前后内容及成员清单检查，发现非协作写入则失败。该互斥不提供任意崩溃点的跨文件回滚保证。备份创建不重置游标，也不自动获取其他进程的所有权。

恢复先校验全部成员，再独占创建目标，写入期间保留 `.backup-restore-incomplete`。中途失败的目录不能用于运行，应保留原备份及源数据，改用另一个新目标重试。正式采用恢复结果时，退出 Desktop 与 CLI，保留当前数据目录备份后再切换；不要覆盖正在运行的数据。Desktop 快照中的 `desktop/quota` 属于 Desktop profile，切换统计目录时需核对目标 profile 的恢复行为。普通 CLI 快照不包含统计目录之外的 Desktop 额度设置。

本机面板的校验预览显示文件类别、有限的来源列表及实际用量桶首末时间（UTC），不代表期间每一天都有数据。保护恢复使用 `restore-protected` 动作，在当前统计目录 `backups/before-restore-*.json` 原子发布保护快照后才创建恢复目标。保护失败不会开始恢复；保护成功、恢复失败的响应仍返回保护路径。保护文件不自动清理，也不嵌套进入后续备份。旧 `restore` 动作保持原语义；同一运行端拒绝并行备份操作（409/BACKUP_BUSY）。新目录仅有所选备份内容，不与当前数据合并，不自动切换实例。

## 升级前迁移状态

运行时只读取 Quotern 的设备身份和 Desktop 配置目录，识别 Quotern 进程及自启服务。已有安装在升级前需完成一次显式迁移。

1. 退出 Desktop，停止 CLI；如曾注册旧名称的自启服务，先用原版本的 `service stop` 撤销它。迁移过程中保持应用关闭。
2. 备份当前统计数据，并确认正式统计目录为 `~/.quotern/`。
3. 将原设备身份目录完整复制到新目录：Windows 为 `%APPDATA%/quotern`，其他平台为 `$XDG_CONFIG_HOME/quotern`，未设置时为 `~/.config/quotern`；使用目录覆盖变量时改为 `QUOTERN_CONFIG_HOME`。确认 `device-id` 与 `~/.quotern/config.json` 中的 `deviceId` 一致。
4. 如有旧 Desktop 设置，先备份原 Electron `userData`。Tauri profile 和 WebView 存储的迁移兼容性须先核对，不能假设直接复制 Chromium 存储即可生效或安全合并。
5. 启动 Quotern，核对设备身份、统计数据和设置。如需自启，用 `quotern service start` 重新注册。

仓库提供通用的显式复制工具，可对设备身份或 Desktop 配置目录分别执行：

```bash
node scripts/migrate-state.mjs --from "/原状态目录" --to "/Quotern状态目录"
```

工具在临时目录复制并逐文件校验 SHA-256、权限及符号链接，再独占创建目标目录、复制并复核；源目录保留作为备份。目标已有不同内容（包括空目录）时会中止，避免覆盖当前设置；目标与源完全一致时可重复运行。写入目标途中失败时，源目录及不完整的目标都保留，需备份并处理不完整目标后重试。多个原目录或新旧目录同时有设置时，需先备份并选择要保留的完整配置，不能将 Chromium 数据库直接合并。目录复制不负责更新系统自启注册，也不会自动清理配置中的停用字段。

## 订阅读数的环境与账号

按账号启动、Quotern 默认账号与自动 Claude 换号，以及独立的实际消费连接见 [账号启动与费用](account-launch-billing.md)。默认选择保存在 `account-launch/preferences.json`，运行端注册监控目录来源到同目录的 `sources.json`；账单私有凭据与缓存保存在 `billing-private/`，不参与普通数据备份。新本地动作接口为 `/functions/tud-account-launch` 与 `/functions/tud-claude-billing`，要求真实 loopback Host/来源和运行实例操作 token。

Desktop 额度访问需用户明确同意，授权只属于当前应用会话；不导入其他应用的登录凭据。不支持授权读取的服务提供官方用量页。

CLI 的 Node 额度及服务状态请求通过 `quotaNodeFetch` 显式使用 `HTTP_PROXY` / `HTTPS_PROXY`（也支持小写形式），遵守 `NO_PROXY`，无需设置 `NODE_USE_ENV_PROXY`；localhost 和回环 IP 始终直连，避免将本机 language server 请求交给代理。仅配置系统代理而没有环境代理变量时，Node 请求仍按原行为直连。Desktop 的额度和服务状态网络行为应按当前 sidecar 实现核对。

同一账号的临时失败可以保留最近读数，退出、认证失败或账号变化应清除不再匹配的快照。并发请求返回时再次检查身份或 generation，避免把前一账号的结果发布到当前界面。具体字段和订阅来源差异见[订阅数据说明](./subscription-plan-design.md)，不要假设所有 reader 都有相同缓存与状态枚举。
