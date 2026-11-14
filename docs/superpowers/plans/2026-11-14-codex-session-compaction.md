# Codex Session Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐 Codex 会话统计中的独立压缩请求，避免与普通通知重复计量。

**Architecture:** 在现有数值观察层配对响应与压缩标记，保留普通事件身份与累计基线。通过缓存版本升级补扫历史，查询仍只读已采集数值。

**Tech Stack:** TypeScript、Node.js test runner、现有 Core / Electron 分析宿主。

**Spec:** `docs/superpowers/specs/2026-11-14-codex-session-compaction-design.md`

## Global Constraints

- Node.js 22.13+；依赖与脚本统一使用 `corepack pnpm`，不新增依赖。
- 不改变任务时长、价格规则或普通累计基线；不操作其他会话服务。
- 只持久化白名单数值和哈希；版本 12 和已删除原日志的旧记录继续可读。

## Review Focus

- 压缩用量与标记跨扫描、跨日期到达，按原始请求时间归属。
- 普通通知早于或晚于标记，独立事件与累计快照不能重复收费。
- 相同数值的后续真实请求不能误作旧响应的覆盖证据。
- 旧缓存迁移、归档副本和 fork 回放不能新增重复普通事件。
- 新状态只含数值/哈希，主线程不增加原始日志分析。

### Task 1: 会话压缩计量与历史补齐

**Files:**
- Modify: `packages/core/src/session-observation.ts`
- Modify: `packages/core/src/session-collector.ts`
- Modify: `packages/core/src/backup-validation.ts`
- Create: `packages/core/test/session-codex-compaction.test.ts`
- Modify: `packages/core/test/task-timing.test.ts`
- Modify: `docs/data-notes.md`
- Create: `.changeset/wise-tables-decide.md`

**Interfaces:** 维持 `extractSessionObservation` / `aggregateSessionActivity` / `syncSessionSource` 入口；新增内部配对状态及可选覆盖哈希，不改变现有 UI 及总量桶。

- [x] 写失败测试：独立压缩 460,133 Token、普通通知覆盖、跨扫描状态、累计差分、日期归属、fork 与缓存升级。
- [x] 执行 `corepack pnpm --filter quotern-core test:compile` 与新增测试，确认漏记断言失败。
- [x] 实现数值配对、覆盖去重和缓存升级，保持原普通事件身份。
- [x] 执行新增及现有会话/Codex 回归，再执行 Core 测试。
- [x] 通过隔离的实际案例重放和 Electron 分析进程检查验收数值、原时长；窗口可读取，原生菜单交互未完成，见设计验收记录。
- [x] 独立代码审查，修正发现的问题并更新文档和 changeset，完成本地原子提交。

实施调整：全测发现备份校验的格式上限也需要同步升级；审查发现覆盖哈希需在普通事件合并时保留。两项均经失败回归后修复。实际回放还验证了原始订阅归属；该证据仅在服务与账号一致且没有显式认证时用于压缩请求，不把新账号猜成订阅。
