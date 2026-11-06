# Keeper Insights Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Root owns implementation; bounded read-only review and verification may be delegated.

**Goal:** 在两端交付额度周期回看、性能分析、手动价格和本地备份恢复。

**Architecture:** 在 Core 中集中计算与持久化，经现有 Hono / Desktop IPC 提供 API；Dashboard 业务组件由 Desktop 复用。写操作沿用本机请求保护，备份通过数据事务锁与采集协调。

**Tech Stack:** TypeScript, Node 22.13+, Hono, React, HeroUI 3.2.4, Recharts, Electron；corepack pnpm 11.1.2。

**Spec:** `docs/superpowers/specs/2026-11-06-keeper-insights-design.md`

## Global Constraints

- 工作区 `keeper-insights/Quotern`，分支 `codex/keeper-insights`，不改主工作区、不合并或推送。
- UI 沿用 `docs/ui-guidelines.md`；四语言、Token 单位、USD 费用与单价各自格式保持。
- 不收集正文、不暴露内部账号分区指纹，不把缺失数据当零。
- 浏览器与 Desktop 都要实际运行；开发服务使用 `pnpm dev:*` 隔离入口。

## Review Focus

- 均值不能作为分位数输入，fork 复制的证据不可重复统计。
- 额度 reset / duration / identity 缺失、回拨及功能池，不能被表示为完整周期效率。
- 手动零价、删除恢复、动态规则、冷启动封存及跨进程价格变化。
- 备份成员路径穿越、哈希错误、链接、并发写入及目标已存在。
- 请求过期响应、旧 runtime、演示只读、窄屏表单与键盘返回。

### Task 1: 原始性能分析

Files: `packages/core/src/performance-analysis.ts`, `session-query.ts`, `server/local-api.ts`, `index.ts`; `packages/core/test/performance-analysis.test.ts`；两端 API / routes / FilterChromeActions；共享 `pages/PerformancePage.tsx`。

Interface: `buildPerformanceReport(evidence, sessions, options): PerformanceReport`；`SessionQueryService.performance(range, filters)`；GET `tud-performance`。

- [x] 先测原始 P95、加权速度、去重、fork、空态、时间与维度筛选。
- [x] 实现纯聚合、范围查询和 API；测试返回完整范围统计与最多 100 条最近样本。
- [x] 新建共享页面及两端入口；检查趋势、筛选、会话跳转。

### Task 2: 额度周期详情

Files: `quota/quota-history.ts`, `quota/shared/quota.ts`, `quota/readers/quota-manager.ts`, `quota/readers/quota-store.ts`, `server/state.ts`, `local-api.ts`；Desktop local runtime；共享 `QuotaHistoryPanel.tsx` / `QuotaUsageCard.tsx`；Core history tests。

Interface: `QuotaManager.getHistory(providerId)` 返回当前身份窗口的安全历史；`buildQuotaHistoryReport` 分组周期并按 `prepareSessionObservations` 的真实时间关联；GET `tud-quota-history`，Desktop 注入只读回调。

- [x] 测 reset 容差、回拨/缺失、旧点、不同账号和 `[from,to)` 观察边界。
- [x] 保存新增证据，按需读取安全投影并关联本机订阅用量。
- [x] 额度详情增加历史入口、周期选择、趋势、覆盖帮助及失败重试。

### Task 3: 手动价格

Files: `pricing/manual-pricing.ts`, `pricing/index.ts`, `aggregate-cache.ts`, `session-query.ts`, `server/local-admin-api.ts`, `http-server.ts`；CLI / Desktop startup；shared price UI and tests。

Interface: 独立版本化 `pricing-manual.json`，仅四项有限非负基础费率。GET/POST `tud-local-admin/pricing` 带写令牌和乐观版本检查；保存原子化并触发费用重建。

- [x] 测零价/缺项/非法值/精确匹配、恢复远程参考价、请求规则和上报金额。
- [x] 让手动层参与价格快照及费用缓存版本；避免 models.dev 转换读入手动层。
- [x] 实现本机保护 API 与共享编辑表单，成功后刷新当前目录和用量。

### Task 4: 本地备份恢复

Files: `data-transaction.ts`, `backup.ts`, sync 与 reset/cursors 写入口；Core tests；`packages/cli/src/backup.ts` / CLI 分发；共享设置组件及 local admin API。

Interface: `createDataBackup(dataDir)`、`verifyDataBackup(input)`、`restoreDataBackup(input,target)`；版本清单带 SHA-256，恢复独占新目录；CLI backup create/verify/restore。

- [x] 测 round-trip、损坏/超限/路径/链接、目标冲突、源目录不变和同步互斥。
- [x] 实现有界快照、严格校验、独占恢复、CLI 和两端设置操作。
- [x] 在临时目录做真实创建/校验/恢复并核对恢复后的统计。

### Task 5: 整合验收

- [x] 同步文档入口和 changeset；执行 Core/CLI 测试、两端类型检查及完整构建。
- [x] Chrome 与 Desktop 实测四项主流程、错误、窄屏、键盘、语言、单位；保存截图证据。
- [x] 独立只读审查并修复有效问题；检查 diff，记录测试范围和剩余限制。
- [x] 保留可验收分支与 worktree，确认本次服务已退出，保留验收证据；记录临时产物清理限制，不推送或合并。

## 实施与验收结果（2026-11-06）

四项功能已实现。独立审查发现的账号切换历史错配、缺失父会话时 fork 样本重复、相似模型误继承手动价及备份嵌套结构校验缺口均已修复并覆盖回归。页面验收另修复了价格保存后的焦点恢复和额度曲线悬浮日期。

| 检查 | 结果 |
| --- | --- |
| `corepack pnpm build` | Core、Dashboard、Desktop 和 CLI 完整构建通过 |
| Dashboard `tsc --noEmit`、Desktop `typecheck` | 通过 |
| Core 编译后测试 | 775 项：771 通过、2 跳过、2 失败；两项失败在基线 `866ea41e` 的独立副本复现 |
| Core `scripts/*.test.mjs` | 16 项通过 |
| Dashboard 测试 | 299 项通过 |
| CLI 测试 | 88 项：85 通过、3 跳过 |
| Desktop 测试 | 脚本 47 项通过；业务测试 826 项：806 通过、20 跳过 |
| `test:localization-catalogs` | 通过 |
| `test:session-detail-ui` | 既有会话详情、价格跳转、错误与键盘/窄屏回归通过 |
| `test:keeper-insights-ui` | 独立 Electron 窗口的五组验收通过，见下文 |
| `git diff --check` | 通过 |

Core 两项基线失败为 `dsh.test.ts` 的截断尾帧数量（期望 3、实际 1），以及 `quota-node-fetch.test.ts` 的 NO_PROXY 异常类型（期望 TypeError、实际 TimeoutError）。本次 Windows 使用 Node 24.22.1；这些结果不表示完整测试套件全绿。

Chrome 使用隔离的合成数据，验证 84 个原始样本筛选为 42 个、清除筛选、返回会话、价格零值保存与恢复、额度周期选择、备份创建及恢复、英文深色与 390px 布局。恢复目录经 CLI 重新读取，Token 与费用一致。

[`test:keeper-insights-ui`](../../../apps/desktop/scripts/keeper-insights-smoke.mjs) 使用实际构建的 Desktop renderer / preload 和 Core API，通过 IPC 执行文件写入；原生偏好及额度源使用合成 fixture。覆盖性能筛选和会话跳转、负单价校验/零价保存/恢复及焦点、额度观察周期/账号用量/悬浮时间/窄屏、备份下载/重新选文件/结构校验/已有目录拒绝/真实恢复/损坏文件拒绝，以及 `1.5万 → 15K` 单位切换和四语言界面。脚本每次创建独立数据目录和 Electron profile，不连接既有应用。

检查日志位于本工作区 `.quotern-dev/final-checks/`；最终新功能窗口截图和结果位于 `.quotern-dev/keeper-insights-ui-1793955561497-54696/`。已查看性能宽窄屏、价格、额度历史及恢复结果截图。CLI / Desktop 开发会话的 Job 已记录 ended；保留启动器自己的锁和会话记录，由启动器按归属凭据处理。

边界：未使用真实账号或打包安装器。原生窗口 CUA 截图/坐标调用超时，补用独立 Electron 窗口验收；Chrome 扩展的文件访问权限未开启，文件重新选择通过 Electron 自动化完成，未手动操作系统文件选择对话框。备份恢复到新目录，不自动切换运行中的数据目录；Desktop 额度存储采用步骤见运行维护文档。

基线验证的系统临时目录 `quotern-baseline-17a91a1bc003408baa7aa2579a53289f` 仍有残留：首次清理遇到访问拒绝，后续递归删除被自动审批拦截，未再重试。

## main 合并验收（2026-11-06）

将 `codex/keeper-insights` 的 `939a1401` 合入 main `f97d42a5`，解决 CLI 命令、local-api、额度存储、额度卡和 Dashboard 设置的 5 处冲突，保留 main 新增的 Agent、额度设置与会话诊断能力。

独立合并审查另发现会话格式升级带来的备份兼容问题：校验仍只接受 v11，且遗漏 `tool-result` 与 `SessionOperation`。已支持 v12 和工具结果，并校验操作类型、工具名称及各可选字段。新增测试先复现两项失败，修复后备份测试 8 项全通过；覆盖实际采集链路的备份恢复，以及重新计算摘要后的畸形操作仍被拒绝、恢复目录未创建。

- `corepack pnpm test` 完整通过，包含完整构建和所有包测试。Core 813 项：811 通过、2 跳过；Core 脚本 16 通过；Dashboard 300 通过；CLI 90 项：87 通过、3 跳过；Desktop 脚本 47 通过、业务 832 项：812 通过、20 跳过。上节两项基线失败已由 main 的修复解决。
- Dashboard `tsc --noEmit` 与 Desktop `typecheck` 通过。
- `test:keeper-insights-ui` 的 5 组 Electron 交互验收通过；已查看合并后的额度历史及备份恢复截图。
- `test:session-detail-ui` 通过，覆盖既有会话详情、子会话切换、Desktop IPC、浏览器构建、键盘与窄屏流程。

本轮日志位于 main 工作区 `.quotern-dev/keeper-merge-20261106/`，新功能界面证据位于 `.quotern-dev/keeper-insights-ui-1793962013974-37212/`。仍使用隔离合成数据；未新增真实账号、安装器或系统文件选择对话框的手动验收。
