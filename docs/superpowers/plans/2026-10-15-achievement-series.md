# Achievement Series Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** 按 14 系列组织成就，修正项目归属并保留所有对象收藏。

**Architecture:** Core 在会话采集时识别项目根，事实层合并别名与活跃日期；成就存储保留原始已获得记录，以可撤回的项目设置投影收藏。共享前端按系列聚合，用系列详情承载对象记录和项目管理。

**Tech Stack:** TypeScript、Node.js、React、HeroUI 3、node:test。

**Spec:** `docs/superpowers/specs/2026-10-15-achievement-series.md`

## Global Constraints

- 复用 `codex/achievements` 与现有 worktree。
- 保留 14 系列与所有已获得记录；不存完整 cwd；项目和费用默认不进入分享。
- 前端共享实现覆盖 Dashboard/Desktop；不操作其他会话服务。

## Review Focus

- 子目录和 worktree 合并后，同一天跨 Agent 只计一天；同名不同仓库保持独立。
- 日志删除后旧缓存与徽章继续可读；项目归属迁移不重发同等级通知。
- 重新命名、忽略、合并和撤回后，旧展示架、已读及快照保持一致。
- 详情中所有等级可选，搜索或状态筛选不隐藏应有记录。
- 分享中项目/费用隐藏开关不能被统一名称绕过。

### Task 1: Project identity and reversible ownership

**Files:** 新增 `packages/core/src/session-project.ts`、`packages/core/src/achievements/projects.ts`；修改 session-sources、session-metrics、session-collector、achievements facts/types/store/evaluate；测试 `packages/core/test/achievement-*.test.ts`。

**Interfaces:** 项目证据含 id/label/kind/legacyId；快照附带候选项目与设置；增加 `project` 操作；已获得记录以当前项目映射投影。

- [x] 添加仓库根/worktree/配置根与普通目录候选测试，并运行确认失败。
- [x] 实现根目录识别、缓存升级与事实日期去重，运行身份和事实测试。
- [x] 添加项目设置、撤回、旧收藏及通知兼容测试，并运行确认失败。
- [x] 实现可撤回项目设置与收藏投影，运行 Core 测试。
- [x] 提交 Core 变更。

### Task 2: Series collection and contextual names

**Files:** 修改 `packages/dashboard/src/achievements/view-model.ts`、share-model 与测试；新增系列详情、项目管理组件；修改 Page/Provider/Overlays/CSS；核对 Desktop wrapper。

**Interfaces:** groupAchievements 每 family 一组，保留对象子组；详情通过 family 状态打开；项目管理调用 Core project 操作；统一名称助手仅为允许公开的范围附加身份。

- [ ] 添加多对象聚合、每系列最近目标、推荐展示架和分享名称/隐私测试，运行确认失败。
- [ ] 实现视图模型与名称投影，运行 Dashboard 测试。
- [ ] 实现 14 张系列卡、紧凑详情、项目管理和各入口名称；详情仍可查看旧等级并加入展示架。
- [ ] 构建 Dashboard/Desktop，浏览器检查桌面与窄屏、搜索、项目管理、返回、分享隐私。
- [ ] 提交共享前端变更。

### Task 3: Documentation and final verification

**Files:** `docs/achievements.md`、`docs/data-notes.md`、changeset、本计划。

- [ ] 更新项目口径、系列结构、迁移与可撤回设置说明。
- [ ] 运行根测试命令与 Desktop 构建，读取结果。
- [ ] 对最终差异进行独立只读审查，处理重要发现并定点回归。
- [ ] 提交最终变更，报告分支、验收与限制。
