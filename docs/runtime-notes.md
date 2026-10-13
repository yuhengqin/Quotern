# 运行维护注意事项

排查启动、采集停滞、窗口恢复和更新问题时，先确认 runtime owner，再检查信号、worker 和缓存。避免把窗口是否可见当作采集进程是否运行的依据。

## Runtime owner 与 CLI 服务

同一数据目录的常驻采集由一个 owner 管理，`tud.pid` 记录 `{ pid, kind }`。Desktop 启动时先处理 CLI 自启，再停止 CLI 并接管；macOS / Windows 有对应的 CLI 自启撤销实现。Linux 的撤销分支没有实现，不能据其他平台行为作保证。

Desktop 已运行时，另开 `quotern start` 会作为 observer 提供浏览器面板，通过同步完成信号刷新读数，不建立自己的常驻采集调度。`quotern service stop` 停止 CLI 服务时应保留 Desktop owner。

清理进程使用 [runtime-pid.ts](../packages/core/src/runtime-pid.ts) 与 [runtime-supervisor.ts](../packages/core/src/runtime-supervisor.ts) 的真实命令识别和会话保护。路径含仓库名的 VS Code / Cursor helper 并不等于本项目服务。Windows owner 探测优先使用 PowerShell CIM，不依赖 `wmic`。

证据：[runtime-pid 测试](../packages/core/test/runtime-pid.test.ts)、[CLI 服务实现](../packages/cli/src/service.ts)。

## Hook 与后台轮询

Claude / Codex Hook 写入 `notify.signal`，常驻进程监听后调度同步。当前脚本为 POSIX 的 `notify.sh` 和 Windows 的 `notify.cmd` / `notify.ps1`，不需要在每次通知时启动 CLI。

后台轮询以 1 分钟为起点，同一档位连续 3 个空轮次后逐步退避到 2、5 分钟；下一轮在上一轮完成后安排。Cursor 后台拉取还有 5 分钟最小间隔，手动或 Hook 触发不按该后台间隔限制。数值见 [paths.ts](../packages/core/src/paths.ts)。

排障先区分“没有新数据”“来源被跳过”和“来源报错”，结合 `logs/notify.log`、`logs/sync.log` 与面板同步状态判断。

## 采集 worker 与卡死恢复

Desktop 主进程维护窗口、IPC、BucketStore 和 local-api，通常把同步及 queue IO 交给 utilityProcess。worker 启动失败时可以回退到主进程同步；该分支仍能工作，但不具备进程隔离带来的响应性优势。

[sync-worker.ts](../apps/desktop/src/main/sync-worker.ts) 在独立 worker thread 中维护看门狗。同步进程每 30 秒喂活，连续 5 分钟无法调度时终止该进程，由宿主恢复。把超时器放在已经卡死的事件循环内不能解决这个问题。

[sync-worker-host.ts](../apps/desktop/src/main/sync-worker-host.ts) 在完成一个同步结果或返回同步错误后清零崩溃次数，不在收到 `ready` 时清零。退出事件触发的连续自动重启最多 5 次；后续同步请求仍可能重新启动 worker，因此这不是永久停机开关。

原生 SIGTRAP 应保持致命信号语义，普通 SIGTERM / SIGINT / exit 清理监听继续保留，见 [native-crash-signals.ts](../apps/desktop/src/main/native-crash-signals.ts) 及[对应测试](../apps/desktop/src/main/native-crash-signals.test.ts)。

## 窗口与 IPC 初始化

主窗口关闭后销毁 BrowserWindow 和 renderer，应用继续驻留托盘；用户再次打开时重建窗口。静默登录启动只影响第一次显示，后续明确的打开请求应正常显示窗口。

窗口、local-api 与更新 IPC 必须在首次页面访问前注册。初始化期间的打开请求由 [main-window-launcher.ts](../apps/desktop/src/main/main-window-launcher.ts) 排队，显式打开优先于静默意图，并发请求合并。macOS 的 Dock 显示需要等待异步操作完成。证据：[窗口启动测试](../apps/desktop/src/main/main-window-launcher.test.ts)。

## 自动更新与失败恢复

正式安装版发现较新版本后自动下载，并在下载完成后尝试安装。Windows portable 只检查和提示新版本，用户手动获取便携包，不下载 feed 中的 NSIS 安装程序。开发模式不启动自动更新。

每次安装尝试都有独立标识。30 秒退出 watchdog 在停止 runtime 之前启动；失败后恢复 runtime、heartbeat 和窗口，并保留已下载包供一次点击重试。旧尝试迟到的完成结果不得触发新尝试安装，恢复过程与重试串行。

退出被取消时保留更新 IPC 和 watchdog；永久清理放在 `will-quit`。electron-updater 6.x 的安装 latch 在恢复后需要重置，否则重试可能被当成重复安装而忽略。

证据：[auto-update.ts](../apps/desktop/src/main/auto-update.ts)、[自动更新测试](../apps/desktop/src/main/auto-update.test.ts)。发布步骤见 [Desktop README](../apps/desktop/README.md#自动更新发布)，历史实机记录见[自动更新验证](../apps/desktop/docs/auto-update-validation.md)，其中旧版本结果不代表当前包已完成实机验收。

## 自启注册与恢复

- Linux：需要 systemd 用户实例；unit 文件存在不代表 enabled。写入、reload 或 enable 失败要撤销残留，见 [service-linux.ts](../packages/cli/src/service-linux.ts)。
- Windows：首次注册计划任务失败会导致 `service start` 失败；已有服务运行时补注册失败仅警告。可在管理员终端注册，或用 `quotern start` 前台运行。
- 持久化后台启动命令时使用真实 Node 和 CLI 路径，避免保存只在当前 fnm / nvm 会话有效的 shim。

用户排障顺序见 [FAQ](../FAQ.md)。检查 PID 对应进程并退出后再处理残留文件；不要仅按名称批量终止开发工具或直接删除整个数据目录。

## 升级前迁移状态

运行时只读取 Quotern 的设备身份和 Desktop 配置目录，识别 Quotern 进程及自启服务。已有安装在升级前需完成一次显式迁移。

1. 退出 Desktop，停止 CLI；如曾注册旧名称的自启服务，先用原版本的 `service stop` 撤销它。迁移过程中保持应用关闭。
2. 备份 `~/.ai-usage/`。统计队列、游标、缓存及配置继续使用该目录，无需改名。
3. 将原设备身份目录完整复制到新目录：Windows 为 `%APPDATA%/quotern`，其他平台为 `$XDG_CONFIG_HOME/quotern`，未设置时为 `~/.config/quotern`；使用目录覆盖变量时改为 `QUOTERN_CONFIG_HOME`。确认 `device-id` 与 `~/.ai-usage/config.json` 中的 `deviceId` 一致。
4. 如有 Desktop 设置，将原 Electron `userData` 整个目录复制到新版本的配置目录。正式安装通常为 `appData/Quotern`，仓库开发版为 `appData/quotern-desktop`；`appData` 在 macOS 为 `~/Library/Application Support`，Windows 为 `%APPDATA%`，Linux 为 `$XDG_CONFIG_HOME` 或 `~/.config`。需保留 `desktop-prefs.json`、`auto-update.json`、`Local Storage`、数据库及其他会话文件。
5. 启动 Quotern，核对设备身份、统计数据和设置。如需自启，用 `quotern service start` 重新注册。

仓库提供通用的显式复制工具，可对设备身份或 Desktop 配置目录分别执行：

```bash
node scripts/migrate-state.mjs --from "/原状态目录" --to "/Quotern状态目录"
```

工具在临时目录复制并逐文件校验 SHA-256、权限及符号链接，再独占创建目标目录、复制并复核；源目录保留作为备份。目标已有不同内容（包括空目录）时会中止，避免覆盖当前设置；目标与源完全一致时可重复运行。写入目标途中失败时，源目录及不完整的目标都保留，需备份并处理不完整目标后重试。多个原目录或新旧目录同时有设置时，需先备份并选择要保留的完整配置，不能将 Chromium 数据库直接合并。目录复制不负责更新系统自启注册，也不会自动清理配置中的停用字段。

## 订阅读数的环境与账号

GUI 启动环境的 PATH 可能缺少 Node 或工具 CLI。Claude reader 使用 [cli-runtime.ts](../apps/desktop/src/main/cli-runtime.ts) 补齐运行环境，在临时目录以受限参数执行 `/usage`；Codex reader 直接读取本机登录状态并请求额度，不以 Codex CLI 是否存在作为前提。

同一账号的临时失败可以保留最近读数，退出、认证失败或账号变化应清除不再匹配的快照。并发请求返回时再次检查身份或 generation，避免把前一账号的结果发布到当前界面。具体字段和渠道差异见[订阅数据说明](./subscription-plan-design.md)，不要假设所有 reader 都有相同缓存与状态枚举。
