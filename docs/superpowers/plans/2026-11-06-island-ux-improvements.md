# Quotern 七项界面优化 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 主代理实现；只读调查/审查与必要机械同步可委派。

**Goal:** 完成用户选定的七项现有能力优化，减少快速查看的阅读成本，并保留全部原能力。

**Architecture:** 扩展 Core 的兼容可选偏好、通知目标和备份摘要；共享 Dashboard 组件承担主交互，Desktop 通过原 IPC 和托盘生命周期接入。保持原数据含义和恢复隔离。

**Tech Stack:** TypeScript、React、HeroUI 3.2.4、Electron、Node、pnpm 11.1.2。

**Spec:** `docs/superpowers/specs/2026-11-06-island-ux-design.md`

## Global Constraints

- 开发目录为本聊天的 island-ux-improvements worktree，分支 codex/island-ux-improvements。
- 两端同类 UI 共用规范，四语言，使用原 FilterMenu/数字格式化。
- 完整模式、原分享卡片、备份 v1、旧调用形状继续可用。
- 不操作正式数据或其他会话服务，不增加新依赖。

## Review Focus

- 多 profile 与展示去重不能把通知定位到另一账号。
- 重点窗口消失或读数过期时回退真实可用数据，不隐藏紧迫风险。
- 异步保存/校验/恢复失败或重复点击不能产生错误成功状态。
- 分享预览与 PNG 尺寸一致，未知/部分费用不伪装完整总额。
- 保护快照失败不创建恢复目录，已成功保护但恢复失败仍能找到保护文件。

## Tasks

### Task 1: 额度关注、账号辨识与恢复动作

**Files:** Core `quota/shared/quota.ts`, `quota/shared/quota-presentation.ts`, `quota/readers/quota-store.ts`, `quota/readers/quota-manager.ts`; Dashboard `QuotaUsageCard.tsx`、相关共享帮助/文案；Desktop adapter。

**Interfaces:** `QuotaPreferences.preferredWindows?: Record<string,string>` 按卡片 ID 保存，空字符串表示自动；共享选择器返回真实存在的窗口并对过期/缺失选择回退。

- [x] 先补偏好合法性、单键合并、缺失窗口/多账号/风险回退用例并确认失败。
- [x] 增加详情中的重点窗口 Select、profile/匿名身份展示和只读登录恢复入口。
- [x] 运行 Core 相关测试和 UI 键盘/保存失败验收。

### Task 2: 额度信息层次

**Files:** `QuotaUsageCard.tsx`, `QuotaServiceDetails.tsx`, 四语言新增文案。

**Interfaces:** 复用现有 QuotaWindow 与 QuotaServiceStatus，不更改采集契约。

- [x] 调整剩余量、进度和重置时间顺序，风险摘要附窗口名称。
- [x] 正常组件列表和来源依据按需展开；异常/未知/过期保持明确。
- [x] UI 验证正常 25 项默认折叠、展开与窄屏；静态核对混合故障、空选、未知及过期分支，不将这些分支视为全部经过动态注入。

### Task 3: 提醒精确定位

**Files:** Core quota-manager、Desktop quota-runtime/TrayPopover、shared quota-navigation、preload/renderer types、共享卡片。

**Interfaces:** 通知目标由 `{ providerId, providerType, windowId?, accountRef?, requestId }` 表示；providerId 是具体卡片 ID，额度通知必须核对已验证的匿名 accountRef，仅同账号可以映射到去重后的卡片。无身份或换号时显示无法定位提示。事件和初始读取共享目标合同。

- [x] 先覆盖多账号目标、重复请求与不匹配窗口用例。
- [x] 透传提醒目标并在详情定位窗口，保留旧无目标打开行为。
- [x] 合成通知点击检查当前/首次打开和重复定位；相关 Core/Desktop 测试通过。

### Task 4: 托盘摘要模式

**Files:** Desktop `TrayPopover.ts`, `TrayPopoverView.tsx`, `TrayPanelControl.tsx`、偏好和类型、共享摘要卡片。

**Interfaces:** 与原 pinned/position 偏好共存的可选 summary 模式；从 Task 1 选择器得到主窗口。

- [x] 偏好归一化与窗口边界回归测试先行。
- [x] 增加切换、紧凑内容和适配高度；详情展开时保证空间。
- [x] 验证摘要/完整切换、固定、位置持久化回调、隐藏重开和原卡片详情；位置测试不代替人工拖拽。

### Task 5: 总览快速查看

**Files:** 两端 DashboardPage、DashboardOverviewCard；共享模式控件。

**Interfaces:** 可选 quickView prop 默认 false；本地偏好键独立，沿用各端 useLocalStorage。

- [x] 增加可见模式切换，快速模式复用费用/总 Token 与额度/洞察。
- [x] 完整分析保持原全部组件，模式切换保留期间与 Agent 筛选。
- [x] 两端宽窄/四语言/单位/部分计价与完整模式回归验收。

### Task 6: 分享编辑

**Files:** ShareActivityModalContent、ShareCardCarousel、SharePosterArtwork、ShareCardActions、share-card-image、share-snapshot、新 share-presentation helper。

**Interfaces:** `SharePresentation` 包含 layout (`details|tokens|cost`)、aspect (`2:3|1:1|4:5|9:16`) 与 userName；默认保持旧卡片。尺寸函数供预览与导出共用。

分享自身的日期、Agent 筛选通过 `useShareReport` 在本次分享会话中缓存 UsageReport；同份报表提供费用证据、Token、模型和累计序列，后台刷新不会只改变费用。旧 runtime 无报表时沿用原用量快照并把费用显示为未知。无证据／全未知显示未知，部分计价标注已计价部分，已知零显示零。预览、导出与配文共用该证据；署名单独作为现有 userName 属性传入。

- [x] 先补尺寸、真实累计序列、缺日/单日数据及配文格式测试。
- [x] 增加主指标/画幅/署名控件和复制配文；分享请求冻结展示参数。
- [x] 验证全部画幅 PNG、三版式内容边界、四语言和长署名，运行既有分享菜单与单位检查；背景库继续复用既有流程，未逐项重做自定义背景操作。

### Task 7: 备份预览与保护

**Files:** Core backup.ts、local-admin-api.ts、backup tests；Dashboard LocalBackupPanel；keeper-insights-smoke。

**Interfaces:** BackupSummary 增加可选内容元数据，旧 v1 不改；新增兼容动作 `restore-protected`，旧 `restore` 保留。成功响应中的结构化结果分别给出 `protection.path/summary` 与 `restore.ok/target/summary` 或 `restore.ok/code`，因此保护成功后恢复失败仍能显示文件路径。保护失败使用明确错误且不开始恢复。API 对并行备份操作返回 409/BACKUP_BUSY。

- [x] 先补有效成员导出的日期/来源/计数、空数据/异常来源边界、保护失败不创建目标及重复请求测试。
- [x] 实现校验预览和服务端保护快照，UI 以单一提交锁区分校验/恢复状态，保留新目录恢复。
- [x] 运行 Core/API 备份测试和 keeper UI 真实恢复流程（合成数据目录）。

### Final verification

- [x] 两端构建、相关单元测试、本地化检查与 `git diff --check`。
- [x] `test:keeper-insights-ui`、`test:dashboard-ui`、`test:session-pagination-ui` 与新增场景；人工查看截图。
- [x] 新鲜 reviewer 审查最终 diff 的契约、异步、账号隔离与数据保护；修复重要问题。
- [x] 同步 docs/ui-guidelines.md 与运行维护说明，记录未验证平台。提交本分支，保留可验收工作区，不擅自合并其他活跃会话的 main。

## 验收记录（2026-11-06）

- Windows 上 `corepack pnpm test` 全量通过（退出码 0），包含仓库策略/开发实例检查、全量构建及全部包测试；平台相关跳过项保留。Core 主套件 823 通过、2 跳过，脚本 16 通过；Dashboard 309 通过；Desktop 两阶段分别 47 通过、813 通过且 20 跳过；CLI 87 通过、3 跳过；i18n 9 通过。日志：`.quotern-dev/island-full-test-final.log`。
- `corepack pnpm --filter quotern-desktop typecheck` 和四语言目录一致性检查通过；`git diff --check` 通过。
- `test:island-ux-ui`、`test:dashboard-ui`、`test:session-pagination-ui`、`test:keeper-insights-ui` 均退出码 0。结果分别保存在 `.quotern-dev/island-ux-final`、`island-dashboard-final`、`island-sessions-final`、`island-keeper-final`。检查了窄屏分享、四画幅 PNG、浮窗摘要以及备份成功/冲突截图；最后调整的备份路径文字已在重新构建后的截图中核对。
- 两次分工独立审查发现的 Escape 抬键隐藏、通知确认后的换号定位、费用与 Token 快照不同步均已修复；后续有界复核未发现有证据的新增 P1/P2。首次通知焦点与按住/松开 Escape 的原生键盘路径补入最终 UI 验收。
- 验收使用独立临时目录与合成账号数据。未发送真实系统通知、未操作真实上游账号；macOS 原生窗口、人工鼠标拖拽和全部自定义背景操作未实测。没有把备份预览的统计信息称为已去重增量，也没有自动覆盖或切换当前数据目录。
