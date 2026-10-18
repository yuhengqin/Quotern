# Quota Management Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. 主代理实现；只读调查、独立审查与限定验证可派发，机械同步才交给 mechanical_editor。

**Goal:** 完整实现已确认的七项额度管理能力。
**Architecture:** 规范窗口与纯分析位于 shared，main 管理后台采样/持久化/通知，IPC 分发统一快照，现有额度卡与托盘消费。
**Tech Stack:** TypeScript, Electron 35, React 19, HeroUI 3.2.4, Node tests.
**Spec:** ../specs/2026-10-16-quota-management-design.md

## Global Constraints

- 分支 codex/quota-management，独立 worktree；不改正式用户数据或服务。
- 不保存或通过 IPC 暴露凭据，不增加产品依赖。
- 未知、无限额、零、耗尽保持不同语义；缺少证据时不生成预测。
- 主进程唯一通知/采样所有者；偏好写入成功后才应用。
- 所有新增时间计算可注入时钟；测试使用临时目录与虚构快照。

## Review Focus

- 账号切换、token 轮换和迟到响应不能污染另一账号的历史/提醒。
- 缓存重播和失败降级不能伪造新鲜数据或耗尽预测。
- 休眠跨周期、时间抖动和供应商利用率回调不能重复通知。
- 保存失败/损坏偏好不应重新启用被关闭的通知。
- Windows 托盘定位、退出清理与多屏边界保持可用。

### Task 1: 动态窗口与分析模型
Files: shared/quota.ts, shared/quota-analysis.ts, shared/*-subscription.ts, main/codex-subscription.ts, main/claude-subscription.ts and tests.
Consumes existing provider snapshots; produces QuotaWindow/QuotaProviderState and pure normalize/analyze/evaluate functions.
- [x] 先测试动态命名限制、未知比例/无限额、账号键、周期/节奏/ETA/阈值边界，确认失败。
- [x] 实现规范模型、Codex/Claude 扩展、纯分析并跑相关测试。

### Task 2: 后台服务与持久化
Files: main/quota-manager.ts, main/quota-store.ts, main/quota-runtime.ts and tests.
Consumes QuotaWindow and provider readers; produces manager state/preferences/change subscription and refresh commands.
- [x] 先测试新数据门、身份变化、并发、429/Retry-After、空闲/锁屏、保存失败和 dispose，确认失败。
- [x] 实现 90 天历史、偏好、provider 状态、后台定时及系统通知；验证上述行为。

### Task 3: 应用接线与托盘
Files: main/index.ts, main/TrayPopover.ts, preload/index.ts, shared IPC contract, renderer Window declaration, pet-controller.ts.
Consumes manager; exposes getState/setPreferences/refresh/onChanged and tray risk summary.
- [x] 测试受限 IPC 参数、平台定位/摘要及清理，确认失败后接线。
- [x] Windows 启用 popover、保留主窗口菜单；绑定电源/锁屏/恢复及退出。

### Task 4: 额度卡与设置
Files: renderer/components/SubscriptionUsageGrid.tsx, quota UI components, SettingsModal and necessary styles/tests.
- [x] 使用已有 HeroUI 组件，显示更多窗口展开、周期/新鲜度、节奏、ETA、微型图与服务状态。
- [x] 设置通知种类、周节奏、趋势显示、通道显隐，并通过主进程保存。
- [x] 运行 typecheck/前端相关检查，受控数据验收窄屏、键盘和图形交互。

### Task 5: 验证与交付
- [x] 独立只读代码审查并修复实际问题。
- [x] Desktop tests/typecheck、全仓 pnpm test、隔离 Electron 和界面验收。
- [x] 同步订阅/运行文档，记录实测覆盖与限制，提交到独立分支，保留可验收 worktree。
