# Contributing Guide

源码仓库：[yuhengqin/Quotern](https://github.com/yuhengqin/Quotern)。

## 安装依赖的注意事项
已发布 CLI 的运行时需要 Node.js >= 20.10；从源码构建、开发和测试使用 Node.js 22.13+。克隆后先在仓库根执行 `corepack pnpm install --frozen-lockfile --prefer-offline`，pnpm 版本以根 `package.json` 的 `packageManager` 为准。

如 `pnpm install` 卡在 electron postinstall

Electron 二进制默认从 GitHub Releases 拉取；国内网络可能会超时

请在安装前设置环境变量：

```bash
# Git Bash / macOS / Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
corepack pnpm install --frozen-lockfile --prefer-offline
```

```powershell
# PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
corepack pnpm install --frozen-lockfile --prefer-offline
```

从 `main` 拉分支，PR 回 `main`。

多 worktree 并行开发及服务归属见 [worktree 开发规范](./docs/worktree-development.md)。Codex 独立任务分支使用 `codex/<short-desc>`；不要切换其他会话的工作区或停止其开发服务。

## 从 Source code 归档构建

GitHub Release 底部的 `Source code (zip)` / `Source code (tar.gz)` 是对应 tag 的源码快照，包含工作区各包和完整 `vendor/dsh-pet`，不包含 `.git`、依赖或编译结果。解压后在含根 `package.json` 的目录执行：

```bash
corepack enable
corepack pnpm install --frozen-lockfile --prefer-offline
corepack pnpm build
corepack pnpm --filter quotern-desktop typecheck
```

安装包含 Electron 下载，需要网络或上面的镜像设置。`build` 会构建 core、i18n、Dashboard、CLI（含面板静态文件）和 Desktop，无需 Git 历史或 Apple 签名密钥。CLI 输出在 `packages/cli/dist/`，Desktop 输出在 `apps/desktop/out/`；在支持的桌面系统上可用 `corepack pnpm --filter quotern-desktop start` 预览已构建应用。Linux 可构建源码与 CLI，目前不提供 Linux 桌面安装包。

生成安装包需要对应系统的打包工具。macOS 默认 `adhoc` 模式无需 Apple 会员或凭据，同时生成 ARM64/x64 的 DMG、ZIP，并采用手动更新；`signed` 模式需要 Developer ID 证书与公证凭据，保留自动更新，见 [发布验收](./RELEASE.md#desktop-统一构建与验收)。在 Git checkout 中使用 `corepack pnpm build:desktop:mac` 或 `corepack pnpm build:desktop:mac:signed` 构建并验证。源码归档没有 Git commit 可供发布证明，在完成上面的根 `build` 后，可只生成本机测试包：

```bash
corepack pnpm --filter quotern-desktop exec node ../../scripts/release-macos.mjs --mode adhoc --build-only
```

`--build-only` 包含 ad-hoc 签名与手动更新标记，但不生成可用于 Release 汇总的验证报告。不要使用 `identity=null` 替代 ad-hoc，ARM64 原生代码仍需有效签名。维护者可从 Git checkout 验证与 GitHub 源码归档等价的构建：

```bash
# 精确检查已提交的 HEAD（也可传 --ref v<version>）
corepack pnpm check:source-archive
# 本地检查当前未提交源码，包含新增文件，排除依赖与旧构建结果
corepack pnpm check:source-archive --working-tree
# 共享依赖存储损坏或需隔离下载缓存时，可额外使用全新临时 pnpm store
corepack pnpm check:source-archive --working-tree --isolated-store
```

检查器将源码打成 tar，在系统临时目录的全新位置解压，确认没有 `.git` 和旧产物，再重新安装冻结依赖、检查 `workspace:*` 链接、执行完整构建与 Desktop 类型检查。外部依赖允许使用 pnpm 全局存储，工作区包必须指向解压目录内。终端会输出报告和保留的临时目录，供验收后按归属清理。归档接收者直接执行上面的构建命令即可，无需运行依赖 Git 的归档生成检查器。

## 提 Issue

先按场景选对入口：

| 场景 | 去处 |
| --- | --- |
| 装不上、面板打不开、`LOCAL_RUNTIME_NOT_READY` | 先看 [FAQ](./FAQ.md) |
| 不确定是不是 Bug、想问用法、想先讨论方案 | [Discussions](https://github.com/yuhengqin/Quotern/discussions) |
| 可复现的缺陷 | [🐞 Bug 报告](https://github.com/yuhengqin/Quotern/issues/new?template=bug-report.md) |
| 新功能 / 改进建议 | [🆕 需求与改进](https://github.com/yuhengqin/Quotern/issues/new?template=feature-request.md) |

Bug 报告务必写清**端、版本、操作系统、复现步骤**，缺这几项我们没法定位。日志在 `~/.quotern/logs/` 下（`daemon.log` / `sync.log` / `notify.log`）。

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

仅修改 Markdown（`**/*.md`）、`docs/` 目录或根 `LICENSE` 的 push / PR 会跳过这套 CI；只要同时包含其他文件的改动，仍运行三平台验证。Actions 页面的手动运行不受文档过滤影响。

数据口径、运行恢复及验证边界见[开发协作注意事项](./docs/development-notes.md)及其关联文档。

## 按端启动

数据目录：`~/.quotern/`。Desktop 启动会接管 runtime 并停止 CLI；Desktop 已运行时再执行 `quotern start`，CLI 以观察模式提供浏览器面板，采集仍由 Desktop 负责。

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

本地浏览器面板通过 CLI 提供数据。执行 `pnpm dev:cli`，打开启动输出中的 Vite 地址即可调试。开发数据保存在当前 worktree 的 `.quotern-dev/`，不接管正式 `~/.quotern/` runtime。

## 发版

发版、里程碑与 changelog 由维护者按 [发版与里程碑规范](./RELEASE.md) 执行。
