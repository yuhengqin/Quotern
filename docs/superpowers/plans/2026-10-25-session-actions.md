# Session Actions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The primary agent owns implementation and acceptance.

**Goal:** 会话详情可打开本机目录、在新终端执行固定恢复命令，并保留复制功能。

**Architecture:** Core 注册带本机来源校验与动作令牌的会话动作接口；共享详情组件经现有 HTTP/IPC transport 调用。平台启动器只接收运行端解析的目录和固定 argv。

**Tech Stack:** TypeScript, Node child_process, Hono, React, HeroUI.

**Spec:** ../specs/2026-10-25-session-actions-design.md

## Global Constraints

- 只修改本 worktree，使用 corepack pnpm；无新增依赖。
- 不接受客户端命令、目录或程序路径；目录必须来自已采集会话。
- 保留既有复制、指标与两端共享行为。

## Review Focus

- 跨站、远程 Host、伪造令牌不得启动本机程序。
- 空格、引号、Unicode、shell 元字符不能改变目录和 argv。
- 缺目录、文件代替目录、缺 CLI、启动失败必须有可见反馈。
- 项目内的同名 CLI 不应覆盖 PATH 安装的 CLI。
- 双击与弹窗切换不得重复启动或污染另一个会话的反馈。

### Task 1: Shared runtime actions

Files: `packages/core/src/session-resume.ts`, `session-actions.ts`, `server/session-actions-api.ts`; modify `server/local-api.ts`, `server/state.ts`, `session-insights.ts`; tests `packages/core/test/session-actions-api.test.ts`, `session-actions.test.ts`.

- [ ] Add route tests for valid actions, collected-directory resolution, rejected origins/tokens/body fields and missing directories; run and observe failure against absent routes.
- [ ] Implement fixed resume argv, native launch adapters and API guards. Reuse resume generation in insights.
- [ ] Run Core tests; verify safe quoting using a real inert Windows CLI fixture.

### Task 2: Shared session UI and documentation

Files: `packages/dashboard/src/components/SessionInsightDetails.tsx`, `i18n/usage-messages.ts`, `docs/ui-guidelines.md`, changeset. Desktop already imports the shared component.

- [ ] Add capability lookup and both buttons; disable while pending and announce success/errors near the actions. Preserve copy fallback for unavailable action APIs.
- [ ] Add four-language labels and errors; update UI contract and changeset.
- [ ] Run Dashboard/Desktop type checks, relevant tests, build and diff checks. Inspect the real page and exercise both operations using controlled fixtures.
- [ ] Obtain independent review of the final diff and resolve material findings.
