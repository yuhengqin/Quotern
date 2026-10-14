# Contributing Guide

源码仓库：[yuhengqin/Quotern](https://github.com/yuhengqin/Quotern)。

## 安装依赖的注意事项
发布产物需要 Node.js >= 20.10；仓库开发和测试使用 Node.js 22.13+。克隆后先在仓库根执行 `pnpm install`，pnpm 版本以根 `package.json` 为准。

如 `pnpm install` 卡在 electron postinstall

Electron 二进制默认从 GitHub Releases 拉取；国内网络可能会超时

请在安装前设置环境变量：

```bash
# Git Bash / macOS / Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
pnpm install
```

```powershell
# PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm install
```

从 `main` 拉分支，PR 回 `main`。

多 worktree 并行开发及服务归属见 [worktree 开发规范](./docs/worktree-development.md)。Codex 独立任务分支使用 `codex/<short-desc>`；不要切换其他会话的工作区或停止其开发服务。

## 提 Issue

先按场景选对入口：

| 场景 | 去处 |
| --- | --- |
| 装不上、面板打不开、`LOCAL_RUNTIME_NOT_READY` | 先看 [FAQ](./FAQ.md) |
| 不确定是不是 Bug、想问用法、想先讨论方案 | [Discussions](https://github.com/yuhengqin/Quotern/discussions) |
| 可复现的缺陷 | [🐞 Bug 报告](https://github.com/yuhengqin/Quotern/issues/new?template=bug-report.md) |
| 新功能 / 改进建议 | [🆕 需求与改进](https://github.com/yuhengqin/Quotern/issues/new?template=feature-request.md) |

Bug 报告务必写清**端、版本、操作系统、复现步骤**，缺这几项我们没法定位。日志在 `~/.ai-usage/logs/` 下（`daemon.log` / `sync.log` / `notify.log`）。

## 分支规范

`<end>` 只能是 `desktop` | `cli` | `web`。

| 类型 | 格式 | 示例 |
|------|------|------|
| 新功能 | `feat/<end>/<short-desc>` | `feat/cli/service-status` |
| 修 bug | `fix/<end>/<short-desc>` | `fix/web/rank-layout` |
| 文档 / 构建 / 依赖 | `chore/<short-desc>` | `chore/readme-assets` |

跨端改动用影响最大的一端，PR 正文写清范围（例如 `feat/web/share-card`，注明 Desktop renderer 同步改了）。

Fork [yuhengqin/Quotern](https://github.com/yuhengqin/Quotern) → 按上面开分支 → 提交 Pull Request。

## Commit 规范

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，主语用英文：

```text
<type>(<scope>): <subject>
```

`<type>`：`feat` | `fix` | `docs` | `style` | `refactor` | `perf` | `test` | `build` | `ci` | `chore`

`<scope>` 可选，填模块名：`desktop` | `cli` | `web` | `dashboard` | `core` | `pricing` 等。

```text
feat(web): add GitHub repository link to dashboard actions
fix(pricing): avoid guessing Cursor models as MiniMax
chore(release): point auto-update feeds to v0.1.6
```

## 提 PR

PR 会自动带出模板，按模板填完即可。几个容易踩的点：

- **带上 changeset。** 影响用户的改动都要跑 `pnpm changeset`，并把生成的文件一起提交；纯文档 / CI 改动可跳过。描述写「对用户的影响」而非实现方式，详见 [发版与里程碑规范](./RELEASE.md#changeset-怎么写)。
- **改了面板 UI 要看两处。** `packages/dashboard/src` 与 `apps/desktop/src/renderer` 是同构但独立的两份代码，改一处时确认另一处是否需要同步。
- **跨端改动**在 PR 正文写清影响范围。
- 合并前确保 `pnpm build` 和 `pnpm test` 通过。`pnpm test` 会先构建再跑四个包的测试；只想跑单个包时用 `pnpm --filter quotern-core test`（把包名换成 `quotern` / `quotern-dashboard` / `quotern-desktop` 即可）。

PR 推上来后 CI（`.github/workflows/ci.yml`）会在 Ubuntu、macOS、Windows + Node 22 上跑同一套命令：`pnpm build` → 桌面端 `typecheck` → 四个包的测试。CI 红了先看是哪个包哪一步挂的，本地用上面对应的 `--filter` 命令复现。

数据口径、运行恢复及验证边界见[开发协作注意事项](./docs/development-notes.md)及其关联文档。

## 按端启动

数据目录：`~/.ai-usage/`。Desktop 启动会接管 runtime 并停止 CLI；Desktop 已运行时再执行 `quotern start`，CLI 以观察模式提供浏览器面板，采集仍由 Desktop 负责。

本地 CLI 用量页（`http://127.0.0.1:8452`）来自 `packages/dashboard`；桌面端使用独立的 renderer 源码副本。

### Desktop

路径：`apps/desktop`

```bash
pnpm install
# 开发热更新：
pnpm dev:desktop
# 构建依赖后启动 Electron
pnpm start:desktop    
```

### CLI

路径：`packages/cli`（面板来自 `packages/dashboard`）

```bash
pnpm install
pnpm start:cli        # 构建后启动，面板 http://127.0.0.1:8452
pnpm dev:cli          # 独立 CLI API + Vite HMR（实际地址见启动输出）
pnpm dev:status       # 只读查看当前 worktree 的端口与会话归属
```

根命令 `start:cli` 会先执行 `build:cli`；直接运行 CLI 包的 `start` 命令时，修改 UI 后需要先重新构建。

### Dashboard 开发

本地浏览器面板通过 CLI 提供数据。执行 `pnpm dev:cli`，打开启动输出中的 Vite 地址即可调试。开发数据保存在当前 worktree 的 `.quotern-dev/`，不接管正式 `~/.ai-usage/` runtime。

## 发版

发版、里程碑与 changelog 由维护者按 [发版与里程碑规范](./RELEASE.md) 执行。
