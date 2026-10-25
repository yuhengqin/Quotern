# Session Detail Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在一个详情弹窗内快速查看关联会话并返回父状态，保留独立打开能力。

**Architecture:** 共享详情宿主管理查看栈，已访问内容保留挂载状态。弹窗级缓存优先复用完整快照，缺失时按来源/实际期间合并读取；浏览器与 Desktop 复用详情和窗口入口。

**Tech Stack:** React 19、HeroUI v3、TanStack Router、现有 HTTP/IPC transport、Node test、Electron 合成 UI 验收。

**Spec:** docs/superpowers/specs/2026-10-26-session-detail-navigation-design.md

## Global Constraints

- 用户已确认实现方案，按当前仓库规则在干净 main 执行；无需再次确认执行方式。
- 两端数据入口保持等价；通知精确查询仍使用已采集历史。
- 不用关联用量投影补造活动、计费或恢复信息；不引入依赖。
- 保留原有信息及四项本机操作；数字沿用已登记格式化入口。

## Review Focus

- 快速进入/返回时迟到请求不得替换当前详情。
- 相同 ID 不同来源与不同期间不能误用缓存。
- 失败/未找到仍可返回和重试。
- 隐藏的父详情不得参与焦点和无障碍名称；返回恢复原触发器及滚动。
- 独立窗口保留 IPC 和范围校验，不扩大允许的导航范围。

### Task 1: Scoped detail data and links

**Files:** 新建 lib/session-detail-cache.ts、lib/session-activity-query.ts 与测试；扩展 session-page、两端 useSessionActivity。

**Interfaces:** SessionDetailCache 提供 seed/get/load；createSessionDetailSearch(identity, range) 生成精确期间链接；sessionPeriod=selected 是页面期间标记，sessionActivityQuery 将其映射为来源和实际边界读取，FocusedSession 精确定位完整快照中的会话。

- [x] 写缓存复用、合并、重试、来源隔离及期间链接测试，运行观察失败。
- [x] 实现缓存与链接；期间读取遵守实际边界，既有通知不变，兼容不认识新增 URL 参数的旧运行端。
- [x] 运行针对性测试并检查两端类型。

### Task 2: One modal with navigation history

**Files:** SessionDetailDialog.tsx、SessionActivityPanel.tsx、SessionsPage.tsx、usage-messages.ts。

**Interfaces:** 详情增加完整 sessions 快照参数，关联名默认切换内容并按意图预取；辅助链接独立打开。

- [x] 扩展合成 UI 场景，覆盖往返状态、加载失败、缓存和独立打开。
- [x] 实现单 Modal 查看栈、隐藏父内容、返回/焦点/滚动、错误重试；向详情传递未被列表筛选裁剪的完整行。
- [x] 接入 Desktop 独立会话窗口，复用原生安全导航及预加载。

### Task 3: Acceptance and closeout

**Files:** 合成 UI 脚本、UI 规范、changeset、当前计划。

- [x] 更新规范和 changeset，运行两端 build、typecheck、Dashboard/Core 相关测试及 test:session-detail-ui。
- [x] 查看实际截图、请求计数及键盘焦点证据；派发独立 reviewer 并处理实质问题。
- [x] git diff --check，记录已运行检查及未测限制。

## 执行记录

- 独立审查发现旧 Core 会忽略精确目标上的日期边界。修正为前端使用旧接口已支持的来源＋实际期间读取，保留完整快照并在本地定位；Core API 无需变更。新增 query 回归测试已观察 RED→GREEN，UI 合成运行端按旧行为忽略新增标记。
- 详情缓存和链接针对性测试 17/17 通过；Core 全套编译测试 704 通过、2 项 Windows 环境限制跳过；Desktop 测试、四语言目录检查通过。最终界面验收与修正后构建见后续记录。
- 合成 UI 验收首次运行确认旧入口缺少新的按钮；后续桌面端已覆盖内切换、缓存、独立 IPC 窗口。新增多层状态测试的选择器改为断言实际显示的汇总数值，避免假定第三方组件使用 aria-pressed。
- 最终根 build、Desktop typecheck、Dashboard 全测试、Core 编译及全套测试、Desktop 全测试、四语言检查和 git diff --check 均通过。两端 test:session-detail-ui 的 30 组场景通过；已直接查看最终宽屏子详情和窄屏关联行截图。
- UI 失败测试先关闭上一查看链以创建新缓存；模拟终态失败使用 HTTP 500，与既有 Desktop transport 对 HTTP 503 的运行端恢复重试语义分开。已验证加载失败可重试、缺记录可返回、返回后的迟到响应不改变当前详情。
- 未对真实用户数据进行前后耗时测量；性能证据限定为合成 UI 中已有完整快照时零新增 activity 请求，以及预取/点击/兄弟会话共用一次来源读取。
