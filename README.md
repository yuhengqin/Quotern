<h1 align="center">Quotern</h1>

<p align="center">
  <img src="./apps/desktop/resources/icon.png" alt="Quotern logo" width="200">
</p>

<p align="center">
  你的 AI 用量，一处看清。统一查看 Coding Agent 的用量、额度与费用。
</p>

<p align="center">
  <a href="https://github.com/yuhengqin/Quotern">
    <img src="https://img.shields.io/github/stars/yuhengqin/Quotern?style=flat-square" alt="stars">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/issues">
    <img src="https://img.shields.io/github/issues/yuhengqin/Quotern?style=flat-square" alt="issues">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/releases">
    <img src="https://img.shields.io/github/downloads/yuhengqin/Quotern/total?style=flat-square" alt="downloads">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/releases/latest">
    <img src="https://img.shields.io/github/v/release/yuhengqin/Quotern?include_prereleases&style=flat-square" alt="release">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/commits/main">
    <img src="https://img.shields.io/github/last-commit/yuhengqin/Quotern?style=flat-square" alt="last-commit">
  </a>
</p>

<p align="center">
  <a href="https://github.com/yuhengqin/Quotern/releases">下载安装包</a>
  ·
  <a href="./FAQ.md">常见问题</a>
  ·
  <a href="#agent-自动发现与调用">Agent 自动发现与调用</a>
  ·
  <a href="#本地数据">本地数据</a>
</p>

## 🖥️ 客户端使用

Quotern 提供 macOS / Windows 桌面客户端，安装即用，无需额外配置。

### 下载安装

前往 [Releases](https://github.com/yuhengqin/Quotern/releases) 页面下载对应系统与架构的安装包：

| 系统 / 芯片 | 安装包 | 其他下载 |
| --- | --- | --- |
| macOS Apple Silicon | `Quotern-<version>-mac-arm64.dmg` | 同名 `.zip` |
| macOS Intel | `Quotern-<version>-mac-x64.dmg` | 同名 `.zip` |
| Windows x64 | `Quotern-<version>-win-x64-setup.exe` | `*-win-x64-portable.exe` 便携版 |
| Windows ARM64 | `Quotern-<version>-win-arm64-setup.exe` | `*-win-arm64-portable.exe` 便携版 |

以上是新发布流程的命名规则；旧版本附件名称可能不同。macOS 当前默认采用 ad-hoc 签名、跳过 Apple 公证，应用内提供下载页入口，需手动下载新版并替换应用。首次打开可能受到 Gatekeeper 拦截；确认来自本项目并核对 Release 校验文件后，可按 [Apple 官方说明](https://support.apple.com/en-us/102445)在“系统设置 → 隐私与安全性”中查看“仍要打开”选项。正式 Developer ID 签名、公证模式仍保留，具体构建模式以 Release 说明及验证报告为准。

Release 的 **Source code** 为对应 tag 的源码快照，编译方法见[源码归档构建说明](./CONTRIBUTING.md#从-source-code-归档构建)。

### 首次启动

1. 打开 **Quotern** 应用
2. 首次运行会自动尝试注册 Claude / Codex Hook 并同步本地用量
3. 面板将自动弹出，展示用量趋势、模型分布等数据

如未检测到 Claude / Codex 等 Agent，请确认已安装并使用过至少一次。

用量数据保存在本机，面板直接读取本地统计。

## ⌨️ CLI 使用

需要 Node.js >= 20.10。macOS / Windows / Linux 安装后后台启动即可打开本地面板：

```bash
npm i -g quotern
quotern service start
# 面板: http://127.0.0.1:8252
```

国内网络较慢可用 `npm i -g quotern --registry=https://registry.npmmirror.com/`。完整命令、选项与数据说明见 [CLI 使用说明](./CLI.md)。

## Agent 自动发现与调用

Quotern 提供 [quotern-usage Skill](./packages/cli/skills/quotern-usage/SKILL.md)，支持 Agent Skills 的 Coding Agent 可根据用量问题自动匹配并调用本地查询。查询时需要可用的 Quotern CLI 和已同步的本地数据；仅安装桌面客户端时，还需额外安装 CLI。

### 推荐：使用 npx skills 安装

使用 [Vercel Skills CLI](https://github.com/vercel-labs/skills) 安装，当前安装器要求 Node.js >= 22.20；Quotern CLI 本身仍支持 Node.js >= 20.10。

```bash
npx skills add yuhengqin/Quotern --skill quotern-usage --full-depth --global
```

按提示选择要安装到的 Agent，推荐使用链接模式：Skill 集中保存在 `~/.agents/skills/quotern-usage/`，安装器为需要独立目录的 Agent 建立链接。Windows 使用目录联接（Junction），无法建立链接时可选择复制模式。`--global` 表示在个人所有项目中可用；只想在当前项目使用时去掉它。

安装前也可只查看仓库中可发现的 Skill：

```bash
npx skills add yuhengqin/Quotern --list --full-depth
```

从本仓库源码安装时，在仓库根目录运行 `npx skills add ./packages/cli/skills/quotern-usage --global`。若远程访问失败，先检查 GitHub 仓库访问权限，或使用已检出的本地源码。

### 交给 Agent 安装

将下面这段话发给当前 Coding Agent，让它按 [Agent 安装说明](./README_AI.md) 完成安装并报告验证结果：

```text
请阅读 https://github.com/yuhengqin/Quotern/blob/main/README_AI.md，
为当前 Agent 全局安装 quotern-usage Skill，保留已有本地定制，
并验证完整文件、技能发现路径及 Quotern CLI 是否可用。
```

### 手动复制（备用）

无法使用安装器时，可从已安装的 CLI npm 包或本仓库复制完整 `quotern-usage` 文件夹，保留 `references/`、`scripts/`、`assets/`。以下以当前项目的 `.agents/skills/` 为例；其他技能目录按所用 Agent 的要求调整。全局安装 CLI 本身不会自动将 Skill 注册到 Agent。

<details>
<summary>查看手动复制命令</summary>

macOS / Linux：

```bash
mkdir -p .agents/skills
cp -R "$(npm root -g)/quotern/skills/quotern-usage" .agents/skills/
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force .agents/skills | Out-Null
Copy-Item -Recurse (Join-Path (npm root -g) 'quotern/skills/quotern-usage') .agents/skills/
```

也可从本仓库的 [`packages/cli/skills/quotern-usage`](./packages/cli/skills/quotern-usage/) 复制完整文件夹。

</details>

### 让 Agent 调用

按所用 Agent 的方式刷新技能或重开会话，确认已加载 `quotern-usage` 后，直接提问：

```text
查看我最近 7 天的用量信息
最近 30 天 Codex 和 Claude 各用了多少 Token？
统计 Quotern 项目最近 30 天的用量和预估费用
```

Skill 会选择对应查询：宽泛的用量报告默认生成综合 HTML 概览，明确的单项问题直接简洁回答。Agent 通过 `quotern usage` 读取 JSON，例如：

```bash
quotern usage overview --days 7 --json --compact
quotern usage models --source codex,claude --days 30 --json --compact
```

查询只读取已落盘的本地统计，Desktop 运行时也可调用，无需额外启动 Web 服务。Skill 不会隐式启动服务或同步日志；数据新鲜度取决于最近同步，费用为来源报告金额或费率估算。完整参数、数据覆盖和费用口径见 [用量报表与 Agent 查询](./CLI.md#用量报表与-agent-查询)。

## 本地数据

统计数据保存在 `~/.quotern/`，包含 Token 数值、来源、模型和项目归属等信息。解析器读取 Agent 日志或数据库后保存统计桶；配置中还保存本机设备标识等运行信息。

部分来源需要读取 Agent 登录状态以获取账单或订阅额度；价格目录和桌面更新也会访问各自的服务。订阅凭据由主进程处理，界面接收展示快照。数据流与文件用途见[架构注意事项](./docs/architecture-notes.md)。

## 🛠️ 开发注意事项

仓库开发和测试使用 Node.js 22.13+，pnpm 版本以根 `package.json` 为准。克隆后先在仓库根执行 `pnpm install`。

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

## 🤝 贡献指南

源码按 Desktop / CLI / 浏览器面板协作。分支规范与本地启动见 [Contributing Guide](./CONTRIBUTING.md)。

- [Desktop](./CONTRIBUTING.md#desktop) — Electron 桌面端
- [CLI](./CONTRIBUTING.md#cli) — 命令行与本地面板
- [Dashboard](./CONTRIBUTING.md#dashboard-开发) — CLI 浏览器面板

维护时请先阅读：

- [架构注意事项](./docs/architecture-notes.md)
- [数据采集与统计注意事项](./docs/data-notes.md)
- [运行维护注意事项](./docs/runtime-notes.md)
- [开发协作注意事项](./docs/development-notes.md)

感谢各位贡献者的支持！提交 PR 即可上榜。

## 📚 参考项目

- [dsh-pet](https://github.com/PC2005-cloud/dsh-pet): 一只住在 DSH 里的桌面宠物：一百余个透明动画随时无缝衔接；还能跟随 DSH 会话事件切换工作状态动画。
- [Token Tracker](https://github.com/xiufengsun/TokenTracker): 自动采集 30 款 AI 编码工具 的 token 用量，用一套漂亮的 Dashboard 看真实成本与趋势。
- [vibe-usage](https://github.com/vibe-cafe/vibe-usage): Token 使用量统计工具（CLI）
- [OpenUsage](https://github.com/robinebers/openusage): The Only AI Usage Tracker That's Truly Yours
- [agent-usage](https://github.com/briqt/agent-usage): 统一采集 Agent 的本地会话数据，通过 Web 仪表板展示 token 用量、费用趋势和会话明细。
- [ccusage](https://github.com/ccusage/ccusage): Coding Agent 用量分析 CLI。
- [models.dev](https://models.dev): 模型 Token 计价数据源，内置计价表由此增量同步
