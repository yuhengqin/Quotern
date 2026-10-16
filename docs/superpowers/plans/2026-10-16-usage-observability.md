# Usage observability Implementation Plan

**Goal:** 交付已选择的六项能力，Dashboard 与 Desktop 同步。
**Architecture:** Core 会话事件账本与额度 manager 分别负责事实采集，HTTP / IPC 提供一致投影，renderer 复用同构组件。
**Tech Stack:** TypeScript、Hono、React、HeroUI、Node test、GitHub Actions。
**Spec:** ../specs/2026-10-16-usage-observability-design.md

## Global Constraints

保持会话隐私、未知值语义、现有 Token 桶及上传兼容；不实现会话缓存诊断；不修改原 main 工作区；仅使用本 worktree 隔离服务。

## Review Focus

日期切片与流式重写；累计计数和 fork 重放；账号冲突与迟到请求；观察时间和查询时间；两端筛选与失败恢复。

## Task 1: 会话事实

- [x] 添加 session-observation 单元测试并确认失败。
- [x] 实现 extractSessionObservation / aggregateSessionActivity，扩展 session collector、SQLite投影和 OMP discovery。
- [x] 接入 tud-session-activity，按日期与 Agent 裁剪并提供未归属桶。
- [x] 运行 Core 聚焦测试。

## Task 2: 账号与额度来源

- [x] 添加 profile校验和来源选择测试并确认失败。
- [x] 实现独立 Claude / Codex reader、profile持久化、OMP观察、manager唯一实例与安全投影。
- [x] 同步 HTTP / Desktop IPC 与 renderer 消费。
- [x] 运行账号、来源、生命周期测试。

## Task 3: 双端界面

- [x] 实现会话卡片、贡献和计费维度；账号管理与来源说明。
- [x] 机械同步 Desktop对应文件，保留独立传输和页面行为。
- [x] 运行前端构建、Desktop typecheck、隔离浏览器验收。

## Task 4: 协议监测与交付

- [x] 添加离线检查器测试并确认失败。
- [x] 实现版本检查器、契约清单和定时去重Issue workflow。
- [x] 独立审查，修复后运行适用检查；记录基线与本次diff、changeset和支持边界。

## 验收记录（2026-10-16）

- 原工作区未提交的 105 个文件先保存字节快照与 SHA-256，隔离实现期间不修改原工作区。后续原工作区提交为 `2fb811b`，105 个快照均与该提交工作区一致，本分支据此建立独立变更基线。
- `npx.cmd --yes pnpm@11.1.2 test`：退出 0，四包构建成功，共 1054 项通过、24 项按平台或条件跳过、0 失败。包含 Core 535 项、Core 定价脚本 6 项、Dashboard 155 项、Desktop 299 项、CLI 18 项及根脚本 41 项通过。完整输出留在本 worktree `.quotern-dev/final-test.log`。
- `npx.cmd --yes pnpm@11.1.2 --filter quotern-desktop typecheck`：退出 0，日志 `.quotern-dev/final-typecheck.log`。
- 独立审查后定点修复：按事件保留计费归属、混合费用、Codex cache alias 与 fork 重放；OMP 不能倒退覆盖官方旧快照，首次 429 保留账号证据与退避；OMP 读取异常保留旧卡并标记陈旧，多账号通知含 profile 名称。
- Dashboard 隔离实例实际操作：会话三个视图；账号添加、编辑、暂停监控、移除及独立卡片。测试 profile 已移除。真实本机历史用于显示检查，合成 SQLite / JSONL 用于归属、缺失值、只读和隐私断言。
- Desktop 隔离启动成功：main、preload、renderer Vite、采集 worker 均就绪；本次工具未提供 Electron 原生窗口交互，因此不宣称完成原生窗口点击或系统通知送达验收。
- 公开网络检查取得全部六个 npm 版本，三个官方页面语义探针通过；报告仍为 `review-required`，因为当前没有经来源版本与样例共同确认的 `verifiedVersion`。没有运行远端 workflow 或创建外部 Issue。
- 多账号显式目录配置首批为 Codex / Claude，其他服务的多账号仅在已适配 OMP 订阅记录中自动发现；真实多个账号的认证切换与额度请求未作端到端验证。会话用量覆盖与桶差异会在界面提示，不能解读为官方额度贡献或账单。
