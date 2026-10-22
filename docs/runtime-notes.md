# 运行维护注意事项

排查启动、采集停滞、窗口恢复和更新问题时，先确认 runtime owner，再检查信号、worker 和缓存。避免把窗口是否可见当作采集进程是否运行的依据。

## Runtime owner 与 CLI 服务

只读演示 `quotern demo start --file <snapshot.json>` 是独立入口，默认监听 `127.0.0.1:8253`，不参与下述正常 runtime owner、Hook、采集、自启和额度调度。它可以与正常客户端并行；停止演示只关闭自己持有的 HTTP server。开发验收使用本 worktree 私有快照和独立端口，不用正常 `start` 代替演示入口。完整步骤见 [CLI 演示说明](../CLI.md#演示快照与只读面板)。

正式运行统一使用 `~/.quotern/`，不提供其他目录名称的识别、自动迁移或兼容入口。隔离开发继续使用当前 worktree 的 `.quotern-dev/data`。

同一数据目录的常驻采集由一个 owner 管理，`tud.pid` 记录 `{ pid, kind }`。Desktop 启动时先处理 CLI 自启，再停止 CLI 并接管；macOS / Windows 有对应的 CLI 自启撤销实现。Linux 的撤销分支没有实现，不能据其他平台行为作保证。

Desktop 已运行时，另开 `quotern start` 会作为 observer 提供浏览器面板，通过同步完成信号刷新读数，不建立自己的常驻采集调度。`quotern service stop` 停止 CLI 服务时应保留 Desktop owner。

清理进程使用 [runtime-pid.ts](../packages/core/src/runtime-pid.ts) 与 [runtime-supervisor.ts](../packages/core/src/runtime-supervisor.ts) 的真实命令识别和会话保护。路径含仓库名的 VS Code / Cursor helper 并不等于本项目服务。Windows owner 探测优先使用 PowerShell CIM，不依赖 `wmic`。

证据：[runtime-pid 测试](../packages/core/test/runtime-pid.test.ts)、[CLI 服务实现](../packages/cli/src/service.ts)。

## Hook 与后台轮询

Claude / Codex Hook 写入 `notify.signal`，常驻进程监听后调度同步。当前脚本为 POSIX 的 `notify.sh` 和 Windows 的 `notify.cmd` / `notify.ps1`，不需要在每次通知时启动 CLI。

后台轮询以 1 分钟为起点，同一档位连续 3 个空轮次后逐步退避到 2、5 分钟；下一轮在上一轮完成后安排。Cursor 后台拉取还有 5 分钟最小间隔，手动或 Hook 触发不按该后台间隔限制。数值见 [paths.ts](../packages/core/src/paths.ts)。

隔离开发入口主动跳过 Claude/Codex Hook 注册，并输出说明性日志；这不表示正式用户的 Hook 配置损坏。非隔离模式注册失败时仍输出警告并使用轮询。

排障先区分“没有新数据”“来源被跳过”和“来源报错”，结合 `logs/notify.log`、`logs/sync.log` 与面板同步状态判断。

## 采集 worker 与卡死恢复

Desktop 主进程维护窗口、IPC、BucketStore 和 local-api，通常把同步及 queue IO 交给 utilityProcess。worker 启动失败时可以回退到主进程同步；该分支仍能工作，但不具备进程隔离带来的响应性优势。

[sync-worker.ts](../apps/desktop/src/main/sync-worker.ts) 在独立 worker thread 中维护看门狗。同步进程每 30 秒喂活，连续 5 分钟无法调度时终止该进程，由宿主恢复。把超时器放在已经卡死的事件循环内不能解决这个问题。

[sync-worker-host.ts](../apps/desktop/src/main/sync-worker-host.ts) 在完成一个同步结果或返回同步错误后清零崩溃次数，不在收到 `ready` 时清零。退出事件触发的连续自动重启最多 5 次；后续同步请求仍可能重新启动 worker，因此这不是永久停机开关。

worker 的启动请求合并，每代进程仅处理自己的消息与等待请求；替换、停止及同步超时会确认旧进程退出，避免并行写入。异常退出记录 PID、退出码、等待请求数和重启计数；V8 fatal error 另记录类型与位置。worker 记录最后请求、看门狗触发和致命异常调用栈。

一轮采集中已落盘但尚未回传的增量，在失败后先通过磁盘刷新 BucketStore 和聚合缓存恢复；恢复失败时，下一轮先重试恢复。正常轮次继续只应用增量，不每轮全量重读。该恢复不提供 queue 与 cursor 跨文件写入在任意崩溃时刻的事务保证。

原生 SIGTRAP 应保持致命信号语义，普通 SIGTERM / SIGINT / exit 清理监听继续保留，见 [native-crash-signals.ts](../apps/desktop/src/main/native-crash-signals.ts) 及[对应测试](../apps/desktop/src/main/native-crash-signals.test.ts)。

## 窗口与 IPC 初始化

主窗口关闭后销毁 BrowserWindow 和 renderer，应用继续驻留托盘；用户再次打开时重建窗口。静默登录启动只影响第一次显示，后续明确的打开请求应正常显示窗口。

窗口、local-api 与更新 IPC 必须在首次页面访问前注册。初始化期间的打开请求由 [main-window-launcher.ts](../apps/desktop/src/main/main-window-launcher.ts) 排队，显式打开优先于静默意图，并发请求合并。macOS 的 Dock 显示需要等待异步操作完成。证据：[窗口启动测试](../apps/desktop/src/main/main-window-launcher.test.ts)。

## 自动更新与失败恢复

正式安装版发现较新版本后自动下载，并在下载完成后尝试安装。Windows portable 只检查和提示新版本，用户手动获取便携包，不下载 feed 中的 NSIS 安装程序。开发模式不启动自动更新。

每次安装尝试都有独立标识。30 秒退出 watchdog 在停止 runtime 之前启动；失败后恢复 runtime、heartbeat 和窗口，并保留已下载包供一次点击重试。旧尝试迟到的完成结果不得触发新尝试安装，恢复过程与重试串行。

退出被取消时保留更新 IPC 和 watchdog；永久清理放在 `will-quit`。electron-updater 6.x 的安装 latch 在恢复后需要重置，否则重试可能被当成重复安装而忽略。

证据：[auto-update.ts](../apps/desktop/src/main/auto-update.ts)、[自动更新测试](../apps/desktop/src/main/auto-update.test.ts)。发布步骤见 [Desktop README](../apps/desktop/README.md#自动更新发布)，历史实机记录见[自动更新验证](../apps/desktop/docs/auto-update-validation.md)，其中旧版本结果不代表当前包已完成实机验收。

## 宠物导入与失败日志

Windows Desktop 的宠物下载使用 Electron `net.fetch`，遵循默认 session 的系统代理/PAC 配置；不使用 Node 全局 `fetch`。请求不携带 session 凭据、不使用缓存，超时覆盖响应流读取，压缩包与解压后文件继续受大小和目录校验限制。

内置角色 ID 保留给内置实现。ZIP、链接和本地 Codex 导入遇到 ID 冲突时，使用 `原ID-imported-内容摘要` 形式的独立 ID（必要时截短原 ID 并加序号），不覆盖原目录或修改 Codex 的源文件。相同内容重复导入会复用已安装角色，保留原有的预览、应用和移除行为。

宠物目录操作的 IPC 失败写入当前数据目录的 `logs/pet-import.log`：正式运行位于 `~/.quotern/logs/`，隔离开发位于当前 worktree 的 `.quotern-dev/data/logs/`。JSONL 条目包含 `ts`、`action`、`phase`、分类 `code`、底层 `diagnosticCode`、错误类型、安全的角色 ID，以及适用时的 HTTP 状态；不记录完整 URL、请求头、原始异常文本或本地文件路径。`phase` 区分 `url/download/archive/validation/install`，其他目录操作失败使用 `catalog`；例如 `ENOTFOUND` 是 DNS 解析失败，`ERR_PROXY_CONNECTION_FAILED` 是代理连接失败。日志沿用 1 MB 轮转及一个 `.1` 备份；写日志失败不会使宠物操作再次失败，取消选择 ZIP 不记失败。

## 自启注册与恢复

- Linux：需要 systemd 用户实例；unit 文件存在不代表 enabled。写入、reload 或 enable 失败要撤销残留，见 [service-linux.ts](../packages/cli/src/service-linux.ts)。
- Windows：首次注册计划任务失败会导致 `service start` 失败；已有服务运行时补注册失败仅警告。可在管理员终端注册，或用 `quotern start` 前台运行。
- 持久化后台启动命令时使用真实 Node 和 CLI 路径，避免保存只在当前 fnm / nvm 会话有效的 shim。

用户排障顺序见 [FAQ](../FAQ.md)。检查 PID 对应进程并退出后再处理残留文件；不要仅按名称批量终止开发工具或直接删除整个数据目录。

## 升级前迁移状态

运行时只读取 Quotern 的设备身份和 Desktop 配置目录，识别 Quotern 进程及自启服务。已有安装在升级前需完成一次显式迁移。

1. 退出 Desktop，停止 CLI；如曾注册旧名称的自启服务，先用原版本的 `service stop` 撤销它。迁移过程中保持应用关闭。
2. 备份当前统计数据，并确认正式统计目录为 `~/.quotern/`。
3. 将原设备身份目录完整复制到新目录：Windows 为 `%APPDATA%/quotern`，其他平台为 `$XDG_CONFIG_HOME/quotern`，未设置时为 `~/.config/quotern`；使用目录覆盖变量时改为 `QUOTERN_CONFIG_HOME`。确认 `device-id` 与 `~/.quotern/config.json` 中的 `deviceId` 一致。
4. 如有 Desktop 设置，将原 Electron `userData` 整个目录复制到新版本的配置目录。正式安装通常为 `appData/Quotern`，仓库开发版为 `appData/quotern-desktop`；`appData` 在 macOS 为 `~/Library/Application Support`，Windows 为 `%APPDATA%`，Linux 为 `$XDG_CONFIG_HOME` 或 `~/.config`。需保留 `desktop-prefs.json`、`auto-update.json`、`Local Storage`、数据库及其他会话文件。
5. 启动 Quotern，核对设备身份、统计数据和设置。如需自启，用 `quotern service start` 重新注册。

仓库提供通用的显式复制工具，可对设备身份或 Desktop 配置目录分别执行：

```bash
node scripts/migrate-state.mjs --from "/原状态目录" --to "/Quotern状态目录"
```

工具在临时目录复制并逐文件校验 SHA-256、权限及符号链接，再独占创建目标目录、复制并复核；源目录保留作为备份。目标已有不同内容（包括空目录）时会中止，避免覆盖当前设置；目标与源完全一致时可重复运行。写入目标途中失败时，源目录及不完整的目标都保留，需备份并处理不完整目标后重试。多个原目录或新旧目录同时有设置时，需先备份并选择要保留的完整配置，不能将 Chromium 数据库直接合并。目录复制不负责更新系统自启注册，也不会自动清理配置中的停用字段。

## 订阅读数的环境与账号

GUI 启动环境的 PATH 可能缺少 Node 或 Agent CLI。Claude reader 使用 [cli-runtime.ts](../apps/desktop/src/main/cli-runtime.ts) 补齐运行环境，在临时目录以受限参数执行 `/usage`；Codex reader 直接读取本机登录状态并请求额度，不以 Codex CLI 是否存在作为前提。

CLI 的 Node 额度及服务状态请求通过 `quotaNodeFetch` 显式使用 `HTTP_PROXY` / `HTTPS_PROXY`（也支持小写形式），遵守 `NO_PROXY`，无需设置 `NODE_USE_ENV_PROXY`；localhost 和回环 IP 始终直连，避免将本机 language server 请求交给代理。仅配置系统代理而没有环境代理变量时，Node 请求仍按原行为直连。Desktop 为 Codex 额度及服务状态注入独立 Electron session 网络，继续沿用系统代理及已有网络恢复流程。

同一账号的临时失败可以保留最近读数，退出、认证失败或账号变化应清除不再匹配的快照。并发请求返回时再次检查身份或 generation，避免把前一账号的结果发布到当前界面。具体字段和订阅来源差异见[订阅数据说明](./subscription-plan-design.md)，不要假设所有 reader 都有相同缓存与状态枚举。
