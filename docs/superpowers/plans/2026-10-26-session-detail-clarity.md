# Session Detail Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按已批准方案精简会话帮助、明确范围切换边界并改善关联列表。

**Architecture:** 继续共享 SessionDetailDialog 和 SessionUsageBreakdown；保留所有聚合逻辑。计算依据使用正文内的原生折叠，避免小帮助浮层内长滚动。

**Tech Stack:** React 19、HeroUI 3、Tailwind 4、四语言目录、Electron 合成 UI 验收。

**Spec:** ../specs/2026-10-26-session-detail-clarity-design.md

## Global Constraints

- 使用 `corepack pnpm`；保持现有运行服务和真实数据不变。
- Dashboard / Desktop 共用实现，保留功能、旧 runtime、未知与零值语义。
- Token、费用、单价分别复用已有公共格式入口。
- 用户已经授权直接执行；当前 main 干净且无并行开发，遵守仓库规则直接在 main 修改。

## Review Focus

- 范围切换后模型表与汇总更新，本会话活动不变且只出现一次。
- 多套费率、单价小数、缺失模型与未计价状态仍可查询。
- 普通/通知入口的期间帮助正确，统计规则和隐私说明仍可访问。
- 多子代理、分叉、单成员历史链接和长角色在 320px/宽屏可读。
- 四语言、键盘开关帮助、表格滚动和参考价新窗口行为保留。

### Task 1: 明确界面验收

**Files:** apps/desktop/scripts/session-detail-smoke.mjs

- [x] 增补区域边界、精简帮助、正文依据和多成员列布局的用户行为断言。
- [x] 在现有构建运行验收，确认首先因新区域缺失而失败。

### Task 2: 共享界面与说明

**Files:** packages/dashboard/src/components/SessionDetailDialog.tsx、SessionUsageBreakdown.tsx、packages/dashboard/src/i18n/usage-messages.ts、docs/ui-guidelines.md、.changeset/session-detail-clarity.md

- [x] 调整共享区域与成员布局，移动依据、统计规则及隐私说明，补全翻译。
- [x] 同步规范和跨端 changeset。
- [x] 执行 Dashboard 测试、本地化、两端类型检查与构建。
- [x] 执行 session-detail-ui 并检查截图，修复可复现问题。
- [x] 独立只读审查本次差异，处理实际问题，核对 git diff --check。

实施记录：基线 d03cf907；完成验收后，用户明确要求创建本次提交，不推送。

## 验证结果

- 新界面断言在旧构建首先因缺少独立活动区域而失败，修改后通过。
- Dashboard 271 项测试、本地化目录检查、Dashboard / Desktop 类型检查和根构建通过。
- `corepack pnpm test:session-detail-ui` 通过，结果为 `.quotern-dev/session-detail-ui-1792944560300-63648/result.json`；普通/通知期间帮助、短费用帮助、完整依据、关联历史、范围切换、320px/375px 与价格窗口均已检查。
- 独立代码与六张截图审查未发现阻塞问题。窄屏长名称可完整换行；真实 24 成员及超长角色没有单独合成验收，不据此宣称覆盖全部数据规模。
- 当前 API/数据统计逻辑及其他会话服务未改动。
