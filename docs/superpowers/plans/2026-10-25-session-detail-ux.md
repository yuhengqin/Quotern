# Session Detail UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将会话详情改为口径一致、重点清晰且保留原能力的可阅读界面。
**Architecture:** Core 增加可选关联用量快照和实际范围；Dashboard 的纯数据转换函数统一摘要/拆分/模型，独立详情组件在两端共享。
**Tech Stack:** TypeScript, React 19, HeroUI 3, Tailwind 4, Node test runner, Electron.
**Spec:** ../specs/2026-10-25-session-detail-ux.md

## Global Constraints
- 实现和冲突整合仅在本任务 worktree；不干扰 session-actions 工作区或现有服务。用户后续明确授权提交并合并回 `codex/session-insights`；本轮不推送。
- 安装和仓库脚本使用 corepack pnpm；沿用公共 FilterMenu 和 HeroUI 焦点管理。
- 原始精度、未知/零、上报/估算、时间范围、父子关系和本机目录读取权限保持。

## Review Focus
- 分叉和多层子代理贡献恰好一次，列表过滤后详情不漏成员。
- 模型费用与会话级未分摊费用不能重复相加，未知项不变零。
- 旧 runtime 缺新可选字段时明确降级，不伪造完整线程明细。
- 无 insight / 无模型 / 部分覆盖仍能查看原有身份、费用和说明。
- 通知定位、关闭焦点返回、窄屏和 Desktop CSS 不退化。

### Task 1: Core 详情契约
Files: packages/core/src/session-insights.ts, session-observation.ts, server/local-api.ts; test/session-insights.test.ts, session-observation-io.test.ts.
Produces: insights.relatedUsage（无递归、无目录的后代用量）；snapshot.range（实际查询范围及 selected/collected）。
- [x] 增加用例并验证缺字段失败：分叉/多层、冲突、未知费用、无隐私字段与通知保留成员。
- [x] 添加向后兼容的可选契约并验证 Core 针对性测试通过。

### Task 2: 共享详情和数据呈现
Files: packages/dashboard/src/lib/session-detail.ts + test, components/SessionInsightDetails.tsx, SessionActivityPanel.tsx, pages/SessionsPage.tsx, i18n/usage-messages.ts; apps/desktop/src/renderer/index.css.
Consumes: Task 1 字段；旧 runtime 仍可读。
Produces: 一致的本会话/线程视图、分类/费用来源、关系拆分、分组折叠及精确值复制。
- [x] 纯函数用例先失败再实现：模型聚合、关系分类、未知值、未分摊费用、原始精度、旧数据降级。
- [x] 独立详情弹窗，移除列表重复嵌入，传递统计范围，更新四语言文案。
- [x] Dashboard 测试、类型/构建与 Desktop 类型检查通过。

### Task 3: 验收与交付
Files: docs/ui-guidelines.md; 限定本任务的 smoke 脚本/合成 fixture 与忽略的截图产物。
- [x] 校验中英文本、宽窄窗口、主题、切换/复制/展开、Escape/焦点返回及 Desktop 实际 renderer。
- [x] 独立 reviewer 审查本次差异并修复必要问题。
- [x] 更新 UI 契约和验证记录，git diff --check，无误纳其他任务改动。

## Execution record
- 用户通过“优化你发现的所有问题”授权执行上述评审方案；按仓库角色规则由主代理实现，子代理仅作有界定位、验证和独立审查。
- Core 两个目标测试文件：14 项通过。Dashboard 全量：255 项通过；详情纯函数覆盖 8 项。双端类型检查和构建通过，构建保留既有分块/大包警告。
- 独立审查后补充 own/thread 导出归属测试并验证先失败、修正后通过；精确模式和 JSON 增加原始任务秒数及计时来源。实际截图修正正文对比度、更多按钮排版以及窄屏长模型名。
- 实机脚本 `apps/desktop/scripts/session-detail-smoke.mjs` 使用独立 Electron profile、合成数据及随机 localhost 端口；Desktop 加载真实 preload/renderer，经 IPC；浏览器构建经 HTTP 加载，不注入 Desktop bridge。未启动真实采集或发出模型请求。
- 最终验收命令：`corepack pnpm --filter quotern-desktop exec electron scripts/session-detail-smoke.mjs ../../.quotern-dev/session-detail-acceptance`（Windows 先清除当前进程的 `ELECTRON_RUN_AS_NODE`）。10 组检查通过，涵盖范围联动、已知小计、恢复/精确数据/目录复制、模型与计价折叠、0 与未记录、Escape/焦点返回/Tab、深色、320/375 px、重复通知、浏览器 HTTP、英文空指标与目录错误重试。截图和 result.json 位于忽略目录 `.quotern-dev/session-detail-acceptance/`。
- 已人工检查浅色首屏、深色窄屏模型区、320 px 摘要和英文会话信息截图；验收 helper 与 fixture server 均已退出。浏览器生产包在 Chromium 内加载，未另外覆盖 Firefox/Safari；未验证操作系统通知投递、真实来源扫描或安装包。
- 首次交付时 UI 规范与 Changeset 已同步，`git diff --check` 通过；变更位于基于 `codex/session-insights` 的 `5f188b7…` 创建的 `codex/session-detail-ux`。后续用户明确要求提交并合并回 `codex/session-insights`，集成时需保留目标分支新加入的本机会话操作。

## 合并验证（2026-10-25）

- UX 改动先提交为 `c9879449`；随后整合目标分支 `3301e292`，包含本机动作 `5740bd25`、交互终端与来源修复 `f5122aa8`、Antigravity CLI 恢复 `aafb3ad2`。冲突仅在原详情组件和 UI 规范；本机动作迁入 SessionDetailDialog，原 SessionInsightDetails 保留兼容导出与上下文审计。
- 保留运行端能力查询、token header、固定身份/action 请求、重复点击防护、成功/错误反馈、旧 runtime 复制回退及显式 null 命令禁止回退；Core 本机动作、安全校验、目录解析和启动逻辑与目标分支一致。补充 PI/ZCode/Antigravity 目录回退；长标题短窗口下，关闭按钮避让只作用于标题行。
- 最终代码执行 `corepack pnpm test`，exit 0：1,926 项，1,890 通过、36 跳过、0 失败；含五包构建。另执行 `corepack pnpm --filter quotern-desktop typecheck`，exit 0。完整测试日志 `.quotern-dev/session-detail-merge-final-test.log`；模块类型、实验 SQLite 与分块/大包警告仍存在。
- 合并实机脚本运行至 `.quotern-dev/session-detail-merged-final/`，13 组检查通过；新增 HTTP/IPC 动作请求、pending 防重复、错误恢复、runtime 命令覆盖/显式 null、旧服务目录与命令复制，以及 320×480 短窗口操作区和正文可达验证。已检查浅色完整头部和短窗口截图；操作端使用合成响应，不代表真实 Agent 恢复已验证。
- 合并冲突解决已获独立只读审查，未发现可行动缺陷；最终 `git diff --check` 通过。目标工作区核查干净，旧开发记录中的主管/子进程已不存在，未修改旧锁或其他预览服务。用户仅授权本地提交与合并，不推送。

## 用户复审修订

用户接受八项评审建议，并明确第六项直接删除 ID/路径原文，以顶部复制按钮替代。复用当前任务工作区，基于 `a744ce64`，按已授权流程验证后提交并本地合并。

- [x] 精简为四按钮、统一数字格式、默认本会话；移除技术原文及重复摘要，复制改 Toast。
- [x] 模型表格与常驻活动指标，补齐四语言文案及共享 UI 规范。
- [x] 更新合成数据实机验收，验证四按钮、Toast、表格、删除项、范围和响应/活动口径；运行相关检查及独立审查。
- [ ] 提交并合回 codex/session-insights，核对目标代码树与验证状态。

### 复审修订验证记录

- `corepack pnpm test` exit 0：五包构建成功，1,926 项中 1,890 通过、36 跳过、0 失败；另 Desktop typecheck 和 `git diff --check` 通过。日志为 `.quotern-dev/session-detail-revision-full-test.log` 与 `.quotern-dev/session-detail-revision-typecheck.log`。
- 更新后的 smoke 先对旧构建验证默认范围断言失败，再对新构建通过全部 13 组检查。最终截图及 result.json 位于 `.quotern-dev/session-detail-revision-acceptance-3/`；覆盖四按钮、Toast 出现/自动消失、表格与活动常驻、展开后无 ID/路径/命令、范围联动 Token 构成和模型且性能/活动保持 own、旧服务复制回退、能力禁用、目录重试、Escape/焦点返回、Tab、重复通知、浅深色、中英文和 320/375 px。窄屏表格用实际方向键验证横向滚动，短窗口操作和正文仍可达。
- 独立审查未发现可行动缺陷。未补做屏幕阅读器实机、Safari/Firefox、安装包或真实 Agent 恢复；本机动作接口及 Core 均无改动。
- 本工作区原共享依赖入口存在但内容缺失；按规定保留原 node_modules 为私有备份后，通过 pnpm 在 `.quotern-dev/revision-dependency-store` 初始化本次验证依赖，未改锁文件、版本或提交机器路径。备份保留于忽略目录 `.quotern-dev/dependency-backups/`，未删除共享存储或操作其他工作区。
