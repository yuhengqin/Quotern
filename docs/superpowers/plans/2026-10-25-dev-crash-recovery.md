# Windows 开发会话异常恢复实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** 修复外层进程树异常退出导致 guardian 和退出凭据一起丢失的问题。

**Architecture:** 本机 WMI 启动独立隐藏 guardian，随机命名管道通信；原 supervisor 句柄确认退出后，通过所属 Job 清理并发布完成凭据。恢复按匹配的凭据判断，不因无关 PID 重用误阻塞。

**Tech Stack:** Node.js ESM、Windows PowerShell、WMI、Win32 Job APIs。

**Spec:** ../specs/2026-10-25-dev-crash-recovery-design.md

## Global Constraints

- 不增加依赖，不停止其他会话；只使用临时目录和受控来源验证。
- Windows 失去所有可信证据时保留锁；POSIX 行为保留。
- 根工作区 main 干净，按仓库规范直接在 main 修改。

## Review Focus

- guardian 真正脱离外层树；创建或握手失败时不能启动任何构建。
- 断开命名管道不能导致监视者提前退出；失败路径不得遗留无期限监视者。
- 原 supervisor 句柄和会话身份必须匹配；不能根据复用 PID 清理进程。
- Job 归零和凭据写入存在短延迟时允许有限等待；错误与未知状态不能当成功。
- 并发恢复保持单一所有者，无关实例保持可用。

## Task 1: 独立 guardian 与所属后代收尾

- [x] 在 scripts/dev-runtime.test.mjs 增加强杀外层进程树后恢复、无关实例仍存活的回归，确认当前实现失败。
- [x] 修改 scripts/dev-windows-job.mjs、dev-windows-job-host.mjs、dev-windows-job.ps1，新增 WMI 启动脚本并同步临时测试夹具。
- [x] 运行限定的 Windows 实际进程测试，修复失败路径；补测所属 guard 清理和独立启动失败不运行构建。

## Task 2: 恢复判据与兼容

- [x] 在 scripts/dev-instance.test.mjs 增加有效凭据与历史 PID 重用的失败用例。
- [x] 调整 scripts/dev-processes.mjs、dev-instance.mjs 的 Windows 判定顺序，保留无证据拒绝和 POSIX 行为。
- [x] 运行 dev-instance 和 Windows dev-runtime 检查，核对原有隔离、端口冲突、重复启动、并发恢复断言。

## Task 3: 文档与验收

- [x] 更新 docs/worktree-development.md，记录实际支持的恢复与保守边界。
- [x] 执行相关检查及根测试，报告已有失败、平台跳过和未运行范围。
- [x] 独立审查变更，解决关键问题后完成验收。

## 验证记录

- 原实现：外层进程树强杀后无凭据、有效凭据遇历史 PID 复用两个回归均失败；修复后通过。
- guardian 清理所属残留 guard 的新增断言先失败后通过；外来 guard 和未知内容保持不变。
- 用纯 PowerShell 主管隔离 Node/libuv 自身的嵌套 Job 清理：仅在临时夹具禁用 `TerminateJobObject` 时，所属孤儿持续存活、测试超时失败；恢复实际实现后通过。
- `corepack pnpm test:dev-instance`：22 通过，4 个 POSIX 用例在 Windows 跳过。
- `corepack pnpm test:dev-runtime`：9 通过，5 个 POSIX 用例在 Windows 跳过；包含实际 CLI/Vite 双实例、LAN、Desktop renderer 监听和故障注入。未运行 Electron 原生窗口验收。
- `corepack pnpm build`、Desktop typecheck、4 个 Vite Core 源码检查、契约/迁移/并行启动/本地化检查均通过。
- CLI 75 通过/3 跳过；Dashboard 238 通过；Desktop 主进程 34 通过，renderer/其他 796 通过/20 跳过；i18n 9 通过；Core 脚本 16 通过。
- 根 `corepack pnpm test` 在未改动的 npm 发包 smoke 用例失败：临时工作区的 pnpm 安装报 `packages field missing or empty`。分项继续运行包测试，Core 635 通过/1 跳过，另有未改动的 `qwen3.8-flash resolves current global and China-region prices` 断言失败（实际 0.014844，期望 0.01187）。对应发布、定价、依赖源文件相对 HEAD 无差异；没有把全量检查记为通过。
- 独立只读审查未发现阻塞问题；审查建议的独立 Job 收尾测试已补齐。`git diff --check` 与 changeset 解析通过。
- 验证结束后未发现残留开发 guardian/监视进程，主工作区的原开发端口均未监听。变更在 main 分支开发；本任务不执行发布。
