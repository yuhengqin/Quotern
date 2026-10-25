# 会话本机操作验证记录

2026-10-25；功能提交 `5740bd25`，基于 `codex/session-insights` 的 `5f188b7b`。实现分支为 `codex/session-actions`。

## 已运行

| 检查 | 结果 |
| --- | --- |
| `corepack pnpm build` | Core、i18n、Dashboard、CLI、Desktop 构建通过；有现有的大 chunk 提示 |
| `corepack pnpm --filter quotern-core test` | 最终 664 项：662 通过、2 跳过；另 16 项定价脚本测试通过 |
| `corepack pnpm --filter quotern-dashboard test` | 247 通过 |
| `corepack pnpm --filter quotern-desktop typecheck` | 通过 |
| `corepack pnpm --filter quotern-desktop test` | 806 项：786 通过、20 跳过 |
| `corepack pnpm --filter quotern test` | 74 项：71 通过、3 跳过 |
| `corepack pnpm test:localization-catalogs` | 四语言目录一致性检查通过 |
| `git diff --check` | 通过 |

最初的新增路由测试因缺少接口返回 404 而失败，实施后通过。独立审查发现项目子目录 PATH 可优先执行同名 CLI、HTTP adapter 未使用真实 Host 两项问题；新增回归测试分别复现失败，再修复并通过完整 Core 测试。文件符号链接测试因 Windows 缺少创建权限而跳过；目录树与解析后路径的排除逻辑已实现，不能把该跳过项计作 Windows 实测通过。

Windows 使用真实 PowerShell 执行受控 CLI shim，验证中文、空格、单引号、`&`、`%` 等字符的目录/安装路径与固定 argv。另实际创建独立终端，受控程序记录的 cwd 与 `resume quotern-smoke-session` 参数一致；测试终端已按精确命令身份关闭。未执行真实 Agent 的会话恢复，也未向模型提交消息。

浏览器在真实会话弹窗中观察到两个新增按钮、两个原复制按钮、目录和原有指标；点击目录按钮时观察到禁用/“正在打开…”及后续“已打开项目目录”反馈。后续浏览器控制与原生窗口采集超时，未完成最终原生窗口目录的可视确认和剪贴板内容复验。Desktop 采用共享组件及现有 IPC transport，已完成类型检查和自动化测试；没有运行 Electron 实机验收。macOS/Linux 只有启动契约测试，没有实机验收。

## 首次预览与服务归属（历史记录）

首次预览从 `session-actions-preview/Quotern` 的 `5740bd25` 启动，使用隔离入口 `corepack pnpm dev:cli`：API / 内置面板 `http://127.0.0.1:8454`，Vite `http://127.0.0.1:5197`，会话 `4138a377-288a-4805-a3af-a7f019f4c28d`。当次健康检查及所选会话的目录/恢复能力查询成功。

原 `8453` 服务保持运行，未修改其工作区或启动参数。最初的 `session-actions/Quotern` 预览主管退出后缺少 Windows Job 完成凭据；主管、记录的两个子进程和监视者均已不存在，但这不足以绕过归属规则，因此保留该工作区 `.quotern-dev/` 内的旧锁和记录，没有伪造退出凭据或按端口/进程名清理。新的预览使用独立工作区，不复用这份状态。

Windows 的“默认终端”指系统默认 console 宿主；执行 shell 为 PowerShell，不读取 Windows Terminal 的默认 profile。macOS 使用系统 Terminal，Linux 使用 x-terminal-emulator。

## 合并后验证与开发服务收尾

2026-10-25，`codex/session-insights` 在 `2b76a156` 合入功能线 `5740bd25`、`f5122aa8`、`aafb3ad2`，以及独立验收文档提交 `31454dbd`，无冲突。后续修复包括交互终端环境、Codex 最新目录、PI / ZCode 入口和 Antigravity CLI 的指定会话恢复，具体约束见设计文档和 UI 规范。

合并工作区完整执行 `corepack pnpm test`，退出码 0：共 1,917 项，1,881 通过、36 跳过、0 失败；Core、i18n、Dashboard、CLI、Desktop 构建全部成功。完整输出保存在该工作区的 `.quotern-dev/session-merge-verification.log`（本机忽略文件）。跳过项以及 Electron 实机、发版打包和真实 Agent 恢复仍不计为实测通过。

收尾时核对工作区记录、会话 ID、进程启动时间、健康响应标识和 Windows Job 成员后，通过退出已核实的 Vite 子进程触发原有 supervisor 清理流程。清理结果如下：

| 预览 | 结果 |
| --- | --- |
| `session-actions-fixed-preview`：8455 / 5198，会话 `87e38ab5-f7e4-4d1f-aca6-488e9c504145` | 已停止；主管、CLI、Vite、监视者均退出，Job `ended` 凭据已生成，归属锁已释放，端口无监听 |
| `antigravity-resume-preview`：8456 / 5199，会话 `78a7097a-28e9-44fc-9794-a9cf140f9494` | 已停止；主管、CLI、Vite、监视者均退出，Job `ended` 凭据已生成，归属锁已释放，端口无监听 |
| `session-actions-preview`：8454 / 5197 | Job 中仍有两个 Codex 恢复进程（86704、27588）。用户明确选择保留这两个会话及 8454 预览，未停止其进程或清理归属记录 |
| 原 8453 对比服务 | 未修改，收尾健康检查仍为 200 |

最早 `session-actions` 工作区的异常锁仍按上节限制保留，没有伪造完成凭据或删除未知归属状态。未操作其他会话、正式数据目录或全局共享依赖存储。
