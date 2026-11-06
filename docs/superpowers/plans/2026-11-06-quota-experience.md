# Quota Experience Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve quota readability, service incident visibility, and desktop access on main, then inspect Chrome and Desktop.

**Architecture:** Extend the existing Core quota contract and shared Dashboard card; Desktop keeps its IPC adapter. Public status summaries provide components and unresolved incidents. Private Claude entitlement fields require evidence from the existing CLI reader before integration.

**Tech Stack:** TypeScript, React, HeroUI 3, Electron, Node test runner.

**Spec:** User-approved comparison and implementation request in this chat, 2026-11-06; repository UI and worktree guidelines.

## Global Constraints

- Work directly on main; use isolated `corepack pnpm dev:*` services and preserve unrelated work.
- Preserve existing quota windows, details, forecasts, alerts, stale states, and external status links.
- Share browser-safe UI and logic; update Desktop adapters, CSS sources, and all four locale catalogs.
- Use FilterMenu for service selection. Empty selection means no services selected, never healthy.
- Never read browser cookies or invent monetary data; record unsupported entitlement sources.

## Review Focus

- Malformed status responses and unknown components must not become healthy or recovery notifications.
- Filters, disabled channels, duplicate account profiles and first observations must not generate spurious alerts.
- Past reset times and stale quota reads must not show negative countdowns or valid pace markers.
- Shortcut registration conflicts must preserve settings and provide explicit feedback.
- Compact, narrow, keyboard and dark-theme paths must keep details and focus accessible.

## Tasks

- [x] Core service status: extend `shared/quota.ts`; add `shared/quota-service.ts` parser/filter; fetch public summary JSON in `runtime.ts`; group polling and notify transitions in `quota-manager.ts`; validate/persist settings in `quota-store.ts`. Test parsing, selection, duplicate profiles, stale reads and transition baselines in Core/Desktop quota tests.
- [x] Shared card: add countdown/date control and pace marker; use the existing analysis for remaining-percent direction; add service filtering, incident latest update and official link in `QuotaServiceDetails.tsx`. Connect `onSave` in both grids and Desktop card adapter. Test countdown boundaries and marker direction, then inspect actual modal and keyboard behavior.
- [x] Desktop: add optional global shortcut and test notification through quota IPC; register/unregister only the owned shortcut and report conflicts. Add quota menu-bar mode without removing token/cost modes. Test shortcut lifecycle and quota title, then exercise native Desktop controls.
- [x] Claude entitlements: inspect available CLI/official source contracts; integrate only proven fields. If unavailable, retain current reader and document the specific data-source gap without adding empty product panels.
- [x] Verify: build Core/i18n/Dashboard/Desktop, run focused and workspace tests, inspect Chrome and isolated Desktop, obtain independent review, and update UI contract/docs with actual scope and limitations. Commit the validated changes on main as requested.

## Validation commands

`corepack pnpm --filter quotern-core build`

`corepack pnpm --filter quotern-core test`

`corepack pnpm --filter quotern-dashboard test`

`corepack pnpm --filter quotern-desktop test`

`corepack pnpm --filter quotern-dashboard exec tsc --noEmit`

`corepack pnpm --filter quotern-desktop typecheck`

`corepack pnpm test:localization-catalogs`

`git diff --check`

## 验收记录（2026-11-06）

- 服务解析、组件筛选、按厂商查询与提醒去重、倒计时/日期切换、剩余额度节奏刻度、桌面快捷键、测试通知、macOS 额度摘要均已实现；四语言文案、共享 UI 规范与 changeset 已同步。用户要求验收通过后提交到 main，本次不推送。
- 独立审查指出的两处通知边界已补回归测试并修正：默认全部服务遇到未知组件不能报恢复；修改一个厂商筛选不会清除其他厂商的通知基线。快捷键 dispose 后不能重新注册。
- Chrome 实际组件验收使用明确标注的虚构读数：已检查 375×667 窄屏、长服务名、模态框滚动、End/Enter/Escape 与焦点返回、正常/故障/空选/过期/截止时刻、保存失败与原值保留、中英文和明暗主题。修复了滚动详情中按钮被压缩以及异常文字对比度。临时验收页面已移除。
- Desktop 设置组件在 Chrome 的模拟系统响应中检查了通知已接收/未确认/失败、快捷键冲突不勾选、解除冲突后开启、服务提醒开关。此结果只证明组件反馈，不证明原生通知送达或全局按键触发。
- 隔离 Windows Desktop 的真实额度卡可读取并显示倒计时。自动点击报 `coordinate input geometry is unavailable`，窗口捕获超时；用户在可见的实机窗口协助完成并确认三项检查：在其他应用中用 Ctrl+Shift+U 唤起额度面板、系统测试通知及点击通知打开面板、关闭快捷键后不再唤起。随后通过原生可访问性接口读到设置页“系统已接收测试通知，请检查通知中心。”。通知送达与按键行为以用户实机确认作为证据，不计为自动化覆盖。macOS 菜单栏仅做代码与摘要测试，未在 macOS 实机检查。
- 两处原先失败已定位为测试夹具问题：本机 Node v24.22.1 的 `zstdDecompressSync({ info: true })` 一次消费全部拼接帧，原截断算法因此截掉半个文件；现在保留编码时的独立帧边界，仅截断末帧。`NO_PROXY` 原测试依赖外部 DNS 在超时前失败；现在仅在测试子进程内将合成域名解析到受控本地源站，同时断言响应、认证头及没有代理隧道。未更改两处生产实现或放宽原有行为断言。相关 18 项测试通过，独立只读审查未发现覆盖退化。
- 最终根目录 `corepack pnpm test` 完整退出 0，含全仓构建、开发隔离/运行时检查、四语言校验与各包测试：共 2,127 通过、36 跳过、0 失败。其中 Core 757 通过、2 跳过，Core scripts 16/16；Dashboard 300/300；Desktop scripts 47/47，编译后测试 808 通过、20 跳过；CLI 85 通过、3 跳过；i18n 9/9。两端额外类型检查与 `git diff --check` 通过。
- 验收完成后已停止本会话的隔离 Desktop，核对 Windows Job 完成凭据及所属进程退出，再运行全仓构建与测试。最终日志为 `.quotern-dev/quota-experience-workspace-final.log`，Core 单独复验日志为 `.quotern-dev/quota-experience-core-fixed.log`；前序浏览器验收与构建日志保留在本会话的 `.quotern-dev/quota-experience-*` 路径。

## Claude 权益数据边界

已核对现有 `claude-subscription.ts`、`claude-usage-parser.ts`、本机 Claude Code 2.1.318 的公开帮助及官方命令说明。当前可验证路线仍是已登录 CLI 的百分比额度窗口，未验证个人订阅额外用量金额、赠送余额、session credits 或重置批次/到期字段。参考项目通过 Claude.ai 网页会话访问内部组织路由，字段语义与本项目 CLI 契约不能等同。本次保留 CLI 读取，在详情提供 `https://claude.ai/settings/usage` 入口，不增加空权益面板，不读取浏览器 Cookie。完整自动接入需另有可信数据契约或脱敏样本；本次未宣称该能力已经实现。

## 设置追补：默认提醒、生产入口与自定义快捷键

- 按后续要求将服务故障/恢复提醒的默认值改为开启，已保存的明确关闭值不覆盖。测试通知仅在 Vite 开发 renderer 显示，生产 preview / 安装包不注册测试 IPC。快捷键开关文案改为「打开额度面板」，提供组合键名称输入、保存和四语言错误反馈。
- Core 共享组合键校验与平台别名解析；主进程预约新注册后持久化，成功才释放旧注册，保存失败释放预约而保留旧注册。关闭保留组合，退出释放自身注册。独立只读审查发现的旧快捷键错误遮盖其他设置保存失败问题已修复，并通过真实 IPC 的磁盘失败场景验证。
- Core 全量测试 759 通过、2 跳过，Core 脚本 16/16；Desktop 编译后测试 810 通过、20 跳过，Desktop 脚本 47/47；Vite Core 源码解析 4/4，四语言目录 1/1。Core / Desktop 构建、两端类型检查及 `git diff --check` 通过。本轮未重复根目录全仓测试。
- 在独立 Electron profile、禁用全部订阅读取通道的配置下，以真实主进程 quota runtime、生产 preload / renderer 完成 12 项检查：默认提醒开启、生产按钮隐藏及测试 IPC 不可用、输入验证及错误关联、Windows 原生注册、冲突保留原组合、其他设置保存失败仍可见、解除冲突后替换、quota runtime 重建后从磁盘恢复、关闭保留选择、关闭时保存不遗留注册、窄屏无页面溢出。已查看正常、冲突、保存失败和窄屏截图。原生冲突由同进程的另一独立注册制造，不声称已枚举或识别其他应用的快捷键。
- 日志位于 `.quotern-dev/quota-shortcut-core-test.log`、`quota-shortcut-desktop-test.log`、`quota-shortcut-build-final.log`；实际页面及 IPC 验收结果位于 `.quotern-dev/quota-shortcut-acceptance-1793955192207/result.json`。本轮没有重复物理按键触发、通知送达或 macOS/Linux 实机检查，也未生成安装器。
