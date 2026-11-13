# Desktop Notification Polish Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; investigation and final review are read-only delegated tasks.

**Goal:** 落地已授权的四项系统通知体验优化。

**Architecture:** Core 提供安全的服务摘要及通知生命周期元数据；Desktop 保留统一通知管理器并增加状态对账、暂缓与原生动作适配。Windows bootstrap 的专用入口只向所属实例转发动作。

**Tech Stack:** TypeScript, Electron 35.4.0, Node net/child_process, Windows toast XML。

**Spec:** `docs/superpowers/specs/2026-11-13-notification-polish-design.md`

## Global Constraints

- 不新增原生依赖；保留内部 appId、既有用户 profile、通知策略及 Core 去重。
- 主仓库 main 完全干净、没有并行可写任务，按仓库规则直接在 main 实施；起点 d06b4953。
- 仅操作本会话的隔离验收实例；不接管或停止用户正式 runtime。
- 按语义更新相关文档、changeset；适用检查通过后创建本地原子提交，不推送。

## Review Focus

- URI 激活不得进入正常启动或抢占其他 profile；过期或无效令牌不执行动作。
- XML 特殊字符、控制字符和路径必须安全；显式静音保留应用提示音策略。
- 暂缓后更新到最新告警，恢复、规则关闭和退出取消重发。
- 账号/窗口隔离；stale/unknown 不伪造恢复；不提前清掉刚发的 reset/recovery。
- 仅所选服务进入通知，读取开始的旧状态不得误删新通知。

### Task 1: 通知状态、正文与生命周期

**Files:** Core quota types/manager + tests；Desktop `notifications/manager.ts`, `quota-notices.ts` + tests；`quota-runtime.ts`, `index.ts`。

- [x] 编写并运行失败用例：已选择服务摘要，旧阈值替换，恢复/重置对账，账号/窗口隔离，暂缓及取消。
- [x] 实现结构化服务通知、纯函数正文/有效性判断，接入稳定键、过期时间、manager 动作与计时。
- [x] 运行 Core / Desktop 对应测试并检查输出。

### Task 2: Windows 身份与操作

**Files:** Desktop `notifications/windows.ts`, `activation.ts`, `toast.ts` + tests；`bootstrap.ts`, notifications runtime；native acceptance scripts。

- [x] 编写并运行失败用例：安全 XML、真实命名管道动作转发、过期动作、Windows 显示身份与注册范围。
- [x] 实现按实例注册、两种原生操作、仅转发的 helper 分支和退出清理；注册失败保留基础通知并给出诊断。
- [x] 构建并运行隔离 Windows 原生 Toast；系统 show 与用户截图确认名称、正文和按钮显示。
- [ ] 最终图标截图、物理按钮点击及通知中心可视验收：用户按 Escape 停止 Computer Use，此部分停止，不宣称通过。后续以无可见窗口的真实 Windows 协议激活验证两种动作及撤销行为。

### Task 3: 集成验收与交付

**Files:** Desktop README, UI guidelines, changeset；现有通知验收脚本的必要更新。

- [x] 完整仓库测试（包含构建）通过；最终 Desktop build/typecheck/test 通过，904 passed、20 skipped；通知 smoke 的 `--actions-only` 通过，不打开窗口、不模拟系统送达。
- [x] 独立只读审查差异；修复 ASAR 图标路径、暂缓旧摘要、Unicode 截断，以及实际协议激活暴露的目录尾斜杠问题。新增回归验证通过。
- [x] 本地原子提交；仅清理本会话原生测试身份/协议/进程，不推送。
