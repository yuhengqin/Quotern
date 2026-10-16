# worktree 开发规范

适用于直接在 main 开发、并行分支开发、Git worktree 管理及开发服务的启动、验证和清理。目标是让每个会话独立完成开发，不占用、停止或改写其他会话的资源。

## 工作区与分支

- “并行开发”指已确认有其他会话正在本仓库执行开发任务。仅存在其他 worktree、分支、历史未提交修改或运行中的服务，不足以证明正在并行开发。没有明确的并行开发证据且 main 完全干净时，直接在 main 开发，不因保留的 worktree 另建工作区。main 自身存在未提交修改时，仍按下一条使用独立分支和 worktree；服务归属和隔离规则始终生效。
- 没有并行开发且 main 工作区完全干净时，直接在 main 开发，无需创建分支或 worktree；否则使用独立分支和 worktree。完全干净指在 main 工作区执行 `git status --porcelain` 输出为空，包括没有已暂存、未暂存修改或未跟踪文件；即使未提交修改与本任务无关，也使用独立分支和 worktree。
- 操作前确认 `git status --short --branch`、`git worktree list --porcelain` 及当前绝对目录。已有合适且属于本任务的 worktree 时复用。Codex 新分支使用 `codex/<short-desc>`；其他贡献分支按 [CONTRIBUTING.md](../CONTRIBUTING.md#分支规范)。
- 不在其他会话正在使用的目录切分支、构建、重置、清理文件或安装依赖。不要将多个 worktree 的 `node_modules`、`dist`、`out` 指向同一可写目录；可以使用包管理器的依赖缓存。
- 不把其他任务的未提交修改纳入自己的提交。合并时确认目标目录及分支归属；若目标目录正被其他会话开发或运行服务，保留自己的可验收分支，等待明确协调后再集成。
- 清理前检查未提交修改、未推送提交和本任务启动的服务。只删除本任务确认可丢弃的分支或 worktree；Codex 管理的 worktree 使用应用提供的归档工具。

## 开发入口与端口

服务归属和隔离规则始终生效，包括没有并行开发、直接在 main 开发时。

在各自 worktree 根运行：

```bash
pnpm dev:cli       # 构建本 worktree 的 CLI，再启动独立 API + 浏览器 Vite
pnpm dev:desktop   # 构建依赖，再启动独立 Electron / renderer Vite
pnpm dev:status    # 只读查看此 worktree 的端口及会话记录
```

CLI 与浏览器 Vite 也可分开启动：先 `pnpm dev:cli:api`，待 API 就绪后再 `pnpm dev:cli:ui`。`pnpm dev:dashboard` 等价于后者，默认要求本 worktree 已有所属 API，核对已发布配置的会话 ID 及 `/health` 的 `X-Quotern-Dev-Instance` 响应标识，否则拒绝启动；复用其他 API 必须显式指定代理目标。已有 UI 使用本 worktree API 时，API 重启保持原端口，端口被占用则失败；更改端口前先退出所属 UI。API 与 UI 分别取得资源锁；完整 CLI 取得两者，Desktop 与 CLI API 在同一 worktree 互斥，跨 worktree 使用独立状态。

Dashboard 和 Desktop renderer 的 Vite 开发服务通过 `scripts/vite-core-source.mjs` 将浏览器可用的 Core 入口解析到源码，避免 Core 构建清空 `dist` 时中断热更新。新增浏览器运行时入口时同步维护该插件及回归测试。正式构建、CLI 和 Desktop 主进程继续使用 Core 包的 `dist` 导出；此规则不负责重启运行中的采集进程。`pnpm test:vite-core-source` 在临时目录清空 Core 构建文件，验证两端开发服务仍能加载依赖，并检查正式构建仍读取编译产物。

默认优先使用 API `8452`、浏览器 Vite `5194`、Desktop renderer `5195`。已有服务占用默认 / 保存端口时，启动器寻找其他空闲端口，并保存实际选择；Vite 及 CLI 监听仍严格检查端口，检查后发生竞争时退出报错，绝不停止占用者。打开启动输出中的实际地址，不凭分支名猜端口。

需要固定端口时，在当前命令的环境中指定；显式端口被占用则失败，不自动替换。例如 PowerShell：

```powershell
$env:QUOTERN_DEV_API_PORT = '8462'
$env:QUOTERN_DEV_UI_PORT = '5204'
pnpm dev:cli
```

Desktop renderer 用 `QUOTERN_DEV_DESKTOP_PORT`。环境变量仅用于本地启动，不提交 `.env*`，也不改仓库默认端口来绕过冲突。

只改 UI 时可明确复用已有 API：

```powershell
$env:VITE_CLI_API_ORIGIN = 'http://127.0.0.1:8452'
pnpm dev:cli:ui
```

代理目标须为本地 HTTP(S) origin，无凭据及路径；`/functions`、`/health` 同时代理到该地址。完整 `dev:cli` 始终代理自己启动的 API，拒绝指定外部目标。复用 API 不代表获得其生命周期或数据写入权限；不重启该 API，不操作重置、配置修改、同步等写接口，验收时注明 API 来自哪个分支。Core / CLI 契约改动应启动本分支的独立 API。

## 运行状态隔离

启动器 `scripts/dev.mjs` 和 `scripts/dev-instance.mjs` 将本地状态放在当前 worktree 的 `.quotern-dev/`（Git 忽略）：

| 路径 | 用途 |
| --- | --- |
| `instance.json` | 保存实际端口及此 worktree 的私有目录 |
| `cli.json` / `api.json` / `ui.json` / `desktop.json` | 会话 ID、worktree、分支、命令、supervisor PID、直接子进程 PID、开始 / 结束时间、状态、代理和日志位置 |
| `*.lock/owner.json` | runtime / UI 资源归属；重复启动拒绝抢占 |
| `*.guard/owner.json` | 资源锁获取、恢复、释放共用的短期互斥；记录检查进程 PID 和开始时间 |
| `jobs/<sessionId>.json` | Windows Job 已清空的完成凭据；由独立监视进程原子发布，缺失不代表已经退出 |
| `data/` | 配置、`tud.pid`、heartbeat、采集队列、游标、缓存、图片和运行日志 |
| `config-home/` | 开发设备身份 sidecar |
| `electron/` | 独立 Electron userData / sessionData、偏好和浏览器存储 |
| `*.log` | 此启动会话的构建及服务输出 |

启动器仅给自己的子进程注入 `QUOTERN_DEV_ISOLATED=1`、绝对 `QUOTERN_DATA_DIR`、`QUOTERN_CONFIG_HOME`、`QUOTERN_DESKTOP_USER_DATA` 及实际端口。它不会更改调用者的全局环境。隔离标记缺少必要目录时拒绝启动，禁止回退正式目录。

隔离开发模式不注册 / 替换用户 Claude/Codex hooks，不驱逐其他 runtime，不修改 CLI 自启动，不允许 `quotern service`；正式运行的配置和数据保持原行为。当前代码的正式 Desktop 驱逐逻辑也保护带开发实例标记的 CLI、开发启动器及其子进程。旧版本正式客户端可能不认识此保护标记，不能据此允许未经协调启动旧版本接管。

开发实例独立采集，可读取现有本地来源，写入私有数据目录，可能增加扫描负载；不复制正式身份、账号配置或数据库。首次开发目录没有正式实例中的偏好与缓存。Desktop 与 CLI 在同一开发 worktree 内不同时取得 runtime，避免相互接管。

`pnpm start:cli`、`pnpm start:desktop`、包内直接 `start` / `dev` 命令及系统 `quotern service` 不提供上述启动器隔离。开发时不得用这些入口替代 `pnpm dev:*`，包括直接在 main 开发时；需要验证正式接管 / 系统服务行为时，先明确测试环境和现有服务归属。

## 退出与异常恢复

- 正常退出使用本会话终端的 Ctrl+C。启动器只清理自己创建的子进程树，CLI 优先经自己的 IPC 清理并确认，再由 supervisor 终止所属进程树；确认清理完成后记录结束状态并释放自己的资源锁。POSIX 检查所属进程组，避免父进程退出后遗漏后代。
- Windows 启动器在启动任何构建或服务之前，通过独立 Node 宿主和隐藏的 Windows PowerShell 监视进程建立会话专属 Job Object。监视进程先固定原 supervisor 的内核句柄，再与仍存活的 supervisor 握手；确认 supervisor 已加入 Job、监视进程未加入后才允许启动服务。PowerShell 或 Job 建立失败时不会启动构建和服务。
- Windows 正常退出在停止派生新进程并完成所属子进程的清理后，查询 Job，确认只剩 supervisor 才释放锁。服务父进程意外退出时不按死 PID 扩大停止范围；若 Job 仍有其他成员或查询失败，记录 `cleanup-required` 并保留锁。
- 禁止按端口批量结束进程、按 `node` / `electron` / `vite` 进程名清理，或调用系统 `service stop` 腾端口。端口相同、目录相似、PID 文件存在，都不足以证明归属。
- `dev:status` 不会停止进程或自动修复。`supervisorAlive` 仅表示 PID 是否存在，不能单独证明原会话仍在运行，也不能排除 PID 重用。
- 下次 `pnpm dev:*` 遇到残留资源锁时会尝试只读检查并自动恢复：锁和会话记录的 sessionId、mode、PID、worktree、开始时间必须匹配，supervisor 和记录的所有子 PID 均须不存在；仍存在的 PID 即使可能被复用也保守拦截。旧版本已记录正常清理完成且没有 Job 元数据的 `stopped` 会话可直接恢复。
- 新 Windows 会话的监视进程在 supervisor 退出后继续观察，仅在原 supervisor 句柄已结束且 Job 活跃进程数为零时，将完成凭据写入临时文件并原子发布。恢复必须核对凭据的会话身份、Job 名称和随机 proofToken；即使会话已标记 `stopped`，崩溃遗留的锁也须有该凭据。监视进程失踪、查询失败、凭据缺失或损坏均不代表成功；恢复不会扫描整机孤儿、停止进程或以端口空闲作为清锁依据。
- Job 默认继承覆盖普通进程创建方式产生的本会话后代，独立宿主在 supervisor 加入 Job 之前创建；本方案不主动设置 `KILL_ON_JOB_CLOSE` 或允许后代 breakaway。外层终端 / Codex / Node 的 Job 限制仍然有效，可能在主管退出时清理所属后代或监视进程；监视进程被清理而未发布凭据时保留锁。通过 WMI、计划任务或已有外部服务代为创建的进程不属于这里的普通后代继承保证。Job 机制见 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。
- 旧 Windows 异常会话没有 Job 归属和完成凭据，保留锁并提示一次人工核验恢复，不能用新机制反推旧进程归属。
- 非 Windows 平台对异常退出会话仍保留锁：现有异步子进程记录无法证明进程组列表完整。无法自动恢复时，先人工核对会话记录、进程命令行和后代归属；确认全部结束后才可删除对应残留锁。未知、缺失、损坏或不匹配的记录不会自动接管。
- 同一资源锁的获取、恢复和释放通过 `*.guard/` 串行执行，清理前再次核对记录，避免并发启动误删新锁。若检查过程本身崩溃留下 guard，等待约 24 秒后会提示人工核对；guard 不自动回收。不要删除正在使用的 guard / `config.lock` 或清空整个 `.quotern-dev/`。

## 验收与文档

修改开发启动器或运行隔离逻辑时，验证应使用临时数据目录、受控来源和独立端口。至少覆盖：两实例共存、代理分别指向自身 API、显式端口冲突不影响占用者、重复启动不接管，以及一个实例退出后另一个仍响应。报告区分脚本 / Core 自动化、实际 CLI/Vite 探测和 Electron 实机验证。仅修改文档时检查文档差异即可，无需运行这些测试。

AGENTS.md 只保留适用条件、关键禁令和本文引用。普通文档不会因一个链接自动加入 Codex 指令链，所以引用要明确要求在相关操作前读取。官方建议按任务需要引用相关材料，避免每次修改都要求阅读全部文档；见 [OpenAI 关于 AGENTS.md 的建议](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) 和 [指令加载规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。具体目录名和端口策略是本项目约定，并非 Codex 官方强制要求。
