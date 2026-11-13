# Desktop Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 Desktop 会话重算与主线程阻塞，并异步化运行归属探测。

**Architecture:** Core 共享派发索引并缓存 hydration；Desktop 只读分析请求由独立 utilityProcess 执行，使用当前运行快照；运行归属异步入口不再执行同步系统查询。

**Tech Stack:** TypeScript、Node.js 22.13+、Electron 35 utilityProcess、Hono、node:test。

**Spec:** ../specs/2026-11-13-desktop-responsiveness-design.md

## Global Constraints

- 保留现有 API、会话/费用/关联信息、CLI/demo 兼容性和进程归属安全规则。
- 仓库脚本使用 corepack pnpm；不安装依赖、不改锁文件，不操作其他会话服务。
- main 干净且无并行写入证据，直接 main；验证后本地提交，不推送。

## Review Focus

- 同范围并发查询只构建一次，范围/价格/历史变化后不能返回旧分析。
- API 对返回对象的筛选或标签更新不能污染缓存。
- inferred dispatch 的两分钟边界与歧义判断保持，分页详情仍查所有候选。
- 分析进程崩溃、超时、停止后旧响应不得误完成新请求；不得主线程降级。
- 进程查询失败、PID 复用与开发实例隔离仍遵循原有安全判定。

### Task 1: Core 会话索引与查询缓存

**Files:** packages/core/src/session-dispatch.ts、session-insights.ts、session-query.ts；packages/core/test/session-query-api.test.ts 与新增有界回归测试。

**Interfaces:** 保持 sessionDispatches/enrichSessionInsights 与 SessionQueryService 外部结果兼容；新增内部共享 dispatch index。

- [x] 先补能证明重复全量扫描、重复 hydration、缓存污染及失效的失败测试并运行。
- [x] 实现共享 metadata/会话索引、范围在途合并和 hydration 缓存。
- [x] 运行 Core 定向及完整测试，核对结果与既有语义。

### Task 2: 异步运行归属探测

**Files:** packages/core/src/runtime-pid.ts；packages/core/test/runtime-pid.test.ts 及必要专用测试。

**Interfaces:** 公开同步 helper 兼容；异步 getRunningOwner/writeRuntimeOwner 调用异步探测。

- [x] 补充慢子进程期间事件循环可调度、两字段一致性和归属语义测试，先确认失败。
- [x] 使用异步 execFile；Windows 合并两个字段并合并在途请求，保持有界成功缓存与 WMIC 兼容。
- [x] 运行进程归属/隔离相关测试。

### Task 3: Desktop 分析进程与实际验收

**Files:** apps/desktop/src/main/session-analysis-{protocol,host,worker}.ts、必要可测试服务模块、local-runtime.ts；对应测试；apps/desktop/README.md 与 docs/runtime-notes.md。

**Interfaces:** runSessionAnalysisRequest 接受当前运行快照和只读请求，返回既有 status/body；stopSessionAnalysisWorker 在 runtime 停止时回收。

- [x] 先补快照一致性、故障/停止/旧代与实际分析隔离测试，确认失败。
- [x] 创建按需 utilityProcess，分流明确只读路由，保持 Core 的校验与定价/账号语义。
- [x] 运行 Core/Desktop 测试、类型检查与构建，独立审查变更并处理发现。
- [x] 使用私有开发目录复测性能，核对旧功能、停止本次进程、同步文档与测试证据。
- [x] git diff 检查归属与完整性，创建仅包含本任务的本地提交。
