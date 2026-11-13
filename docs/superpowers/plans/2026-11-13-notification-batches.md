# Notification Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 合并集中系统提醒，允许一次清理当前全部提醒，同时保留紧急投递和原有详情/暂缓能力。
**Architecture:** NotificationManager 保留原始事项，固定窗口合并后投递原生摘要；动作通过现有认证协议/IPC 到同一管理器。摘要本地化独立于队列算法。
**Tech Stack:** TypeScript、Electron 35.4.0、React 19、HeroUI 3.2.4、Node test。
**Spec:** `docs/superpowers/specs/2026-11-13-notification-batches-design.md`

## Global Constraints

- 固定合并窗口 1 秒；额度耗尽、严重服务中断、开发测试立即发送。
- 同账号/窗口替换与四语言、精准定位、Windows 历史撤回契约保留；不引入依赖。
- 当前全部包括 active/pending/snoozed；未来新事件和持久偏好保留。
- 仅在当前隔离 worktree 修改、构建和运行合成测试。

## Review Focus

- 合并后某项恢复/过期/关闭策略，其他有效事项仍可访问且不重复发声。
- 清理和退出后计时器及迟到事件不恢复通知；未来新事件仍发送。
- 队列同 key 替换、去重、显式测试绕过保持一致。
- 混合额度/服务以及恢复/警告摘要不错误地暂缓恢复事项。
- 原生动作顺序、协议鉴权和设置重复提交/失败反馈保持正确。

### Task 1: Queue and lifecycle

Files: `notifications/manager.ts`, `manager.test.ts`, new `summary.ts`, `summary.test.ts`, `shared/notifications.ts`, `shared/notification-messages.ts`.

- [x] 先补上述风险行为的失败测试。
- [x] 实现可选 `batch: { delayMs: number; summarize(notices: DesktopNotice[]): DesktopNotice }`、`count` 和 `clear()`；原始事项始终为生命周期依据。
- [x] 摘要至少两项才使用；单项保持原样，摘要查看进入通用额度面板。
- [x] 编译并运行通知测试，确认失败转通过且原有测试保留。

### Task 2: Actions and settings

Files: `notifications/{runtime,activation,toast,windows}.ts` 及对应测试、`preload/index.ts`、`NotificationSettings.tsx`。

- [x] 原生动作与真实协议测试先失败，再新增 `dismiss-all`；macOS 按实际动作数组映射索引。
- [x] 新增 trusted `notifications:clear` IPC、state `pendingCount`、preload `clear()`、设置按钮及就近反馈。
- [x] 通过共享计数更新显示禁用/忙碌状态；不增加 Dashboard 副本。

### Task 3: Acceptance and closeout

- [x] 扩展 `notifications-smoke.ts` 覆盖普通真实队列、紧急直达、协议批量清理、设置键盘与失败重试。
- [x] 运行 Desktop tests/typecheck/build、通知 actions/UI smoke，查看宽窄屏截图；尝试 Windows 原生历史核对。
- [x] 更新 `docs/ui-guidelines.md` 和 Desktop README，独立代码审查，修正后创建本地原子提交。

## 执行证据

- Desktop 完整测试通过：准备脚本 47 通过；编译后 868 通过、20 跳过、0 失败。类型检查和 `corepack pnpm build:desktop` 通过。
- `notification-batch-actions-01` 的无窗口动作 smoke、`notification-batch-ui-01` 的完整 UI smoke 通过，查看了宽/窄截图；清理失败保留当前事项，键盘重试后清零，提醒策略不变。
- 独立审查发现首次 `show` 前部分撤回会丢失剩余事项首次声音/投递结果，已先用延迟 show 测试复现，再保留逐项完成回调和已显示状态修复；通知单测 41 通过。
- Windows 原生验收 `notification-batch-native-01`：三项真实普通投递只生成一个标题为「3 项额度提醒」的历史条目，含三个原生动作；真实 `dismiss-all` URI 激活后历史从 1 变为 0。实例正常退出。未用物理点击操作系统通知按钮，macOS/Linux 原生表现未实测。
- 主目录已有本会话未启动的运行中 Desktop 开发服务，本任务保留在 `codex/notification-batches` 隔离工作区，不更改该实例或整合 main。
