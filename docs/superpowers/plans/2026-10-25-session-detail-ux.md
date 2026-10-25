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
- [x] 提交并合回 codex/session-insights，核对目标代码树与验证状态。

### 复审修订验证记录

- `corepack pnpm test` exit 0：五包构建成功，1,926 项中 1,890 通过、36 跳过、0 失败；另 Desktop typecheck 和 `git diff --check` 通过。日志为 `.quotern-dev/session-detail-revision-full-test.log` 与 `.quotern-dev/session-detail-revision-typecheck.log`。
- 更新后的 smoke 先对旧构建验证默认范围断言失败，再对新构建通过全部 13 组检查。最终截图及 result.json 位于 `.quotern-dev/session-detail-revision-acceptance-3/`；覆盖四按钮、Toast 出现/自动消失、表格与活动常驻、展开后无 ID/路径/命令、范围联动 Token 构成和模型且性能/活动保持 own、旧服务复制回退、能力禁用、目录重试、Escape/焦点返回、Tab、重复通知、浅深色、中英文和 320/375 px。窄屏表格用实际方向键验证横向滚动，短窗口操作和正文仍可达。
- 独立审查未发现可行动缺陷。未补做屏幕阅读器实机、Safari/Firefox、安装包或真实 Agent 恢复；本机动作接口及 Core 均无改动。
- 本工作区原共享依赖入口存在但内容缺失；按规定保留原 node_modules 为私有备份后，通过 pnpm 在 `.quotern-dev/revision-dependency-store` 初始化本次验证依赖，未改锁文件、版本或提交机器路径。备份保留于忽略目录 `.quotern-dev/dependency-backups/`，未删除共享存储或操作其他工作区。
- 实现提交 `26b67e53` 已从 `a744ce64` 快进合入 `codex/session-insights`，无冲突；目标与实现分支代码一致、Git 状态干净，未推送。

## Token 表格合并

- [x] 删除独立 Token 构成区块；模型费用表首行增加当前口径合计，保留分类、推理包含关系和未知/未分类/未分配说明。
- [x] 验证范围联动、无模型及缺分类、未分配费用、零值、响应式和旧交互，完成独立审查；按既定流程提交并本地合并。

- 基于 `4524d535`，变更只涉及共享详情组件、合成验收脚本及对应文档。独立审查未发现产品缺陷，指出的 smoke 预期文案错误已修正并通过实测。
- Dashboard/Desktop 构建及 Desktop typecheck 均通过，Dashboard 255 项测试全部通过，`git diff --check` 通过。日志为 `.quotern-dev/unified-token-table-*.log`；Dashboard 大包警告仍存在。本次不重复 Core/CLI 测试。
- smoke 在旧构建上因缺少合计行失败；新构建通过 14 组检查。`.quotern-dev/session-detail-unified-table-3/` 保存结果及截图，覆盖首行合计与范围联动、输出包含推理、零值、无模型、分类未知、未分配费用、未分类 Token、中英文、浅深色、320/375 px、表格键盘横向滚动及原有动作/复制/焦点行为。实际操作使用合成 API，未启动真实 Agent 会话。

## 信息层级与回归约束

- [x] 条件显示表尾合计，隐藏默认档位，说明移至相邻帮助入口。
- [x] 两端价格路由支持当前会话模型的明确集合筛选、清除与未匹配处理。
- [x] UI 规范补默认展示和渐进披露原则、反例及验收矩阵，AGENTS 引用同一来源。
- [x] 针对单/多模型、默认/非默认档位、按需帮助及价格跳转执行回归、实机检查与独立审查，再按已有授权提交并本地合并。

### 信息层级修订验证

- 新增单元用例先因缺少实现失败，再通过；针对旧构建的界面检查因单模型仍有重复合计失败。根 `corepack pnpm test` exit 0：1,935 项中 1,899 通过、36 跳过；Desktop typecheck 与 diff check 通过，日志为 `.quotern-dev/session-detail-attention-full-test.log`、`attention-typecheck.log`。最后的表头高度与链接图标调整后，两端构建、Desktop typecheck、Dashboard 264 项测试及界面脚本重新通过。
- 默认参数运行 `corepack pnpm test:session-detail-ui`，18 组检查通过；产物位于 `.quotern-dev/session-detail-ui-1792924015295-58536/`，含完整合计表、稳定帮助浮层、375 px 帮助边界与焦点、模型价格跳转/清除/未匹配截图。对复制提示先验证出现再消失，避免异步提示或悬停暂停干扰后续遮挡检查；截图等待入场动画结束。
- 实机发现价格页原有固定 36 px 表头不能容纳英文双行标题；新增 DOM 文字边界断言先失败，再将表头布局保留高度修至 56 px 后通过。未更改价格分组、比较或排序规则。
- 独立代码审查未发现产品缺陷；独立视觉检查提出的叠印与表头问题已分别以稳定帧截图核实、布局修正解决，最终三张缺口截图再次独立核验通过。
- 权威规则位于 UI 规范的信息呈现章节，AGENTS/CONTRIBUTING 引用同一入口；单元测试进入现有三平台 CI，合成 UI 脚本接入 Windows CI。远端 CI 尚未运行，本次不推送或发布。验证只覆盖本地构建与合成 HTTP/IPC renderer，未运行真实 Agent 恢复或新增屏幕阅读器测试。
- 代码、文档和规则已同步并本地验证；机器记忆与工作区清理不在本轮范围，验证产物保留。现有模块类型、SQLite、静态/动态混合导入及大分块警告保留。

## 紧凑展示与保留原页面

- [x] 参考价无箭头并新页打开；浏览器保留原详情，Desktop 对白名单价格路由使用独立 IPC 窗口及对应窗口控制。
- [x] 会话信息常驻；去掉 recorded 后缀并保留时长帮助/估算状态；关联名称绑定历史链接，角色横排，移除重复操作行。
- [x] 两端构建、类型/单元检查、URL 白名单和真实点击验收；核对窄屏及旧功能，完成独立审查。
- [x] 按既定授权提交并本地合回 `codex/session-insights`，不推送。

### 紧凑展示验证记录

- 新增真实界面断言在旧构建上因会话信息仍折叠失败；新增 URL 白名单测试先失败再通过。Dashboard 264 项通过，Desktop 脚本阶段 23 项通过、编译阶段 788 项通过/20 项跳过，两端构建通过。Desktop 类型检查指出 Electron 事件重载不接受联合类型，改为两个显式监听后通过；修正后 Desktop 构建再次通过。`git diff --check` 通过，日志位于 `.quotern-dev/compact-detail-*.log`。
- 最终 `corepack pnpm test:session-detail-ui` 21 组通过，产物 `.quotern-dev/session-detail-ui-1792925458152-74020/`。实测 file 与 HTTP Desktop 的参考价独立窗口、IPC 与模型筛选，子窗最小化/最大化/关闭和主题变化不影响主窗；无 preload 的 HTTP Dashboard 新页保留原 URL、弹窗和滚动位置。角色横排、名称链接的键盘历史定位、会话信息常驻、时长帮助与估算标识、375/320 px 及旧动作/复制/焦点回归保留。使用合成数据，不执行真实 Agent 恢复或外部系统浏览器动作。
- 独立代码审查仅发现价格窗口原生主题可能滞后，已修正并实测创建前和创建后的主题变化；独立视觉检查三张最终截图未发现名称/角色重叠或截断。账号沿用匿名短标识，截图只代表当前滚动视口。
- 合并前检查发现目标 `codex/session-insights` 工作区干净，但其 CLI/Vite 实例 `aaac6f4d-5718-4789-be33-0085b2ad82bd` 正在运行（API 8454/UI 5197，PID 与命令行已核实）。依 worktree 开发规范第 11 行，先保留本任务可验收分支，不操作该服务或在未协调时更新其工作树。
- 用户随后明确允许“合入并热更新”，实现提交 `6fdbbb9a` 已快进合入目标，未重启服务。两分支代码树一致、工作区干净；5197 `/health` 返回 200 且实例身份不变，服务端已返回新标签链接及无箭头文案。未推送。

## 六项整体精简执行

当前基线 `164d0127`，复用本任务工作区。范围只涉及共享详情组件、四语言文案、实机 smoke 及 UI 规范；Desktop 继续直接共享组件，无 Core/API 或依赖改动。

- [x] 扩展 `apps/desktop/scripts/session-detail-smoke.mjs` 合成数据及断言：无模型已知/未知/已知小计、两项/单项性能缺失与零、单/多关联、无后代/旧 runtime、单/多模型价格依据及宽窄布局。先对旧构建观察预期失败。
- [x] 修改 `SessionDetailDialog.tsx` 的空性能、关联分组、范围入口、活动和信息布局；修改 `SessionUsageBreakdown.tsx` 的空模型和价格依据；必要文案在 `i18n/usage-messages.ts` 四语言同改，正常测量与零值不丢失。
- [x] 同步 `docs/ui-guidelines.md` 现役规则及 changeset，执行两端构建、Dashboard 测试、Desktop typecheck、diff check、实机 smoke 和独立审查，查看最终宽窄截图。
- [x] 仅提交本任务文件，快进合回 `codex/session-insights`，检查 5197 的服务身份、更新后的页面和两分支干净状态，不重启或推送。

### 六项精简验证记录

- 对旧构建的首个界面断言以“会话信息应有两列”失败；长计数新增文本布局断言先证明 320 px 下被拆为三行，再通过跨列布局保持单行。长范围标签在按钮内换行，避免英文窄屏溢出；“无模型”文案明确为缺少用量明细，不否认已有模型名称。
- 最终两端构建、Dashboard 264 项测试/22 suites、Desktop typecheck 及 diff check 通过。构建保留既有大分块和混合导入提示；未改 Core/API/依赖，未重复 Core/CLI 全套。日志为 `.quotern-dev/six-refinements-final-*.log` 与 `six-refinements-readable-typecheck.log`。
- 最终 `corepack pnpm test:session-detail-ui` 28 组通过，结果及截图位于 `.quotern-dev/session-detail-ui-1792927694559-52656/`。覆盖无模型的已知/未知/零/线程已知小计、未分配金额为零、unknown 模型行、有效 0 tok/s 与 0 s、单项缺样本、单成员链接与多成员折叠、旧 runtime 摘要、单模型多套价格证据、320/375/700 px 与短窗口、长计数完整单行、窄屏价格帮助末尾可达，以及原有操作/复制/Toast/通知/焦点/新页价格回归。
- 小计合成场景使用实际 `relatedUsage.knownCostUsd` 契约；不向没有该字段的 SessionActivity 顶层伪造已知小计。新场景统一等待弹窗入场和视口恢复后再交互，失败会输出溢出元素信息，避免动画坐标误击。
- 独立代码审查未发现可行动问题；之后的窄屏长标签/长值调整通过真实几何断言及截图验证。独立视觉检查四张最终宽窄截图未发现重叠、横向裁切或异常留白，零值、大数值和单价规则清晰。使用合成 HTTP/IPC 数据，未执行真实 Agent 恢复、新增屏幕阅读器或安装包验收。
- 实现提交 `35e3b69f` 已快进合回 `codex/session-insights`。5197 健康检查返回 200、实例身份保持 `aaac6f4d-5718-4789-be33-0085b2ad82bd`，更新模块和真实会话均已核对：活动三列、会话信息双列，正常数据和零值可见。真实预览截图为同产物目录的 `live-5197-info.png`。未重启服务或推送。
