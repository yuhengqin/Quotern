<h1 align="center">Quotern</h1>

<p align="center">
  <img src="./apps/desktop/resources/icon.png" alt="Quotern logo" width="200">
</p>

<p align="center">
  <strong>你的 AI 用量，一处看清。</strong><br>
  统一查看 Coding Agent 的 Token、订阅额度、预估费用与会话记录。
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
  <a href="#-快速开始">快速开始</a>
  ·
  <a href="#-功能预览">功能预览</a>
  ·
  <a href="./FAQ.md">常见问题</a>
  ·
  <a href="#agent-自动发现与调用">Agent 自动发现与调用</a>
  ·
  <a href="#本地数据">本地数据</a>
</p>

汇总 Claude Code、Codex、Cursor、Gemini CLI 等多种 AI 编码工具的用量，在一个面板里查看趋势、模型和项目分布。支持 macOS / Windows 桌面客户端，也可通过 CLI 在 macOS / Windows / Linux 上打开本地浏览器面板。

<p align="center">
  <img src="./assets/usage-dashboard.png" alt="Quotern 用量总览：Token、预估费用、订阅额度和活跃热力图" width="960">
</p>

## ⚡ 快速开始

### 🖥️ 客户端使用

Quotern 提供 macOS / Windows 桌面客户端，安装即用，无需额外配置。

#### 下载安装

前往 [Releases](https://github.com/yuhengqin/Quotern/releases) 页面下载对应系统与架构的安装包：

| 系统 / 芯片 | 安装包 | 其他下载 |
| --- | --- | --- |
| macOS Apple Silicon | `Quotern-<version>-mac-arm64.dmg` | 同名 `.zip` |
| macOS Intel | `Quotern-<version>-mac-x64.dmg` | 同名 `.zip` |
| Windows x64 | `Quotern-<version>-win-x64-setup.exe` | `*-win-x64-portable.exe` 便携版 |
| Windows ARM64 | `Quotern-<version>-win-arm64-setup.exe` | `*-win-arm64-portable.exe` 便携版 |

以上是新发布流程的命名规则；旧版本附件名称可能不同。macOS 当前默认采用 ad-hoc 签名、跳过 Apple 公证，应用内提供下载页入口，需手动下载新版并替换应用。首次打开可能受到 Gatekeeper 拦截；确认来自本项目并核对 Release 校验文件后，可按 [Apple 官方说明](https://support.apple.com/en-us/102445)在“系统设置 → 隐私与安全性”中查看“仍要打开”选项。正式 Developer ID 签名、公证模式仍保留，具体构建模式以 Release 说明及验证报告为准。

Release 的 **Source code** 为对应 tag 的源码快照，编译方法见[源码归档构建说明](./CONTRIBUTING.md#从-source-code-归档构建)。

#### 首次启动

1. 打开 **Quotern** 应用
2. 首次运行会自动尝试注册 Claude / Codex Hook 并同步本地用量
3. 面板将自动弹出，展示用量趋势、模型分布等数据

如未检测到 Claude / Codex 等 Agent，请确认已安装并使用过至少一次。

用量数据保存在本机，面板直接读取本地统计。

### ⌨️ CLI 使用

需要 Node.js >= 20.10。macOS / Windows / Linux 可通过 `npx` 直接前台启动，无需预先全局安装：

```bash
npx quotern
# 面板: http://127.0.0.1:8252
# Ctrl+C 停止
```

长期使用可全局安装，并通过后台服务启动（支持系统自启）：

```bash
npm i -g quotern
quotern service start
# 面板: http://127.0.0.1:8252
```

国内网络较慢可用 `npm i -g quotern --registry=https://registry.npmmirror.com/`。完整命令、选项与数据说明见 [CLI 使用说明](./CLI.md)。

常用命令：

```bash
quotern status           # 查看运行状态
quotern sync             # 手动同步本地用量
quotern doctor           # 检查环境与数据源
quotern usage --days 7   # 查询最近 7 天的用量
```

Windows 首次注册开机自启需要管理员权限；Linux 后台服务需要 systemd 用户实例。可用 `quotern start` 前台运行，具体见 [CLI 快速开始](./CLI.md#快速开始)。

## ✨ 特性

- **多 Agent 统一统计**：汇总多种编码工具的本地日志或数据库，按 Agent、模型和项目查看消耗。
- **用量趋势与活跃热力图**：切换今天、最近 24 小时、7 / 30 / 90 天或自定义范围，查看输入、输出、缓存与费用趋势。
- **订阅额度监控**：集中查看已接入渠道的剩余额度、使用窗口和重置时间，展示登录失效等读取状态。
- **会话追溯**：搜索、筛选和排序已采集会话，展开查看模型用量、缓存、费用依据与任务时长。
- **模型价格查询**：查询模型费率，按使用场景估算费用并对比模型；价格目录从 [models.dev](https://models.dev) 更新。
- **成就与分享卡**：记录活跃天数、连续使用与个人成就，将所选时段的用量制作成可下载或复制的分享卡。
- **桌面概览与宠物**：在紧凑概览中查看核心读数，在设置中挑选、预览桌面宠物并调整大小。
- **Agent 直接查询**：通过 `quotern-usage` Skill 用自然语言查询本地统计，支持 JSON / CSV 报表与 HTML 用量概览。

费用会区分来源报告金额、按模型费率估算和价格未知的情况，不能直接当作实际付款账单。会话、消息与任务时长的覆盖范围也因数据源而异，以界面的覆盖提示为准。

## 🖼️ 功能预览

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>会话与用量趋势</strong><br>
      从最近会话追踪使用记录，按时间查看 Token 总量与输入、缓存、输出的变化。<br><br>
      <img src="./assets/sessions-and-usage-trends.png" alt="最近会话列表、Token 总量折线图和用量组成柱状图" width="100%">
    </td>
    <td width="50%" valign="top">
      <strong>Agent、模型与项目分布</strong><br>
      查看用量排行与分布，找到主要消耗来自哪个工具、模型和项目。<br><br>
      <img src="./assets/usage-breakdown.png" alt="Agent 与模型用量排行，以及项目、Agent 和模型分布图" width="100%">
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <strong>会话浏览器</strong><br>
      按 Agent 和项目筛选，搜索会话并切换排序；展开查看模型、输入 / 输出 Token、缓存和费用明细。<br><br>
      <img src="./assets/session-browser.png" alt="带搜索、筛选、分页和展开明细的会话浏览器" width="100%">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>成就展示架</strong><br>
      用徽章、连续活跃记录和逐步解锁的目标留存使用足迹。<br><br>
      <img src="./assets/achievements.png" alt="成就展示架、累计活跃天数、已解锁徽章和接近完成的目标" width="100%">
    </td>
    <td width="50%" valign="top">
      <strong>用量分享卡</strong><br>
      选择时间范围与 Agent，生成包含 Token、预估费用和模型排行的分享卡。<br><br>
      <img src="./assets/usage-share-card.png" alt="用量分享卡预览，包含时间筛选、模型排行、下载和复制入口" width="100%">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>紧凑用量概览</strong><br>
      在小窗口中快速查看配额、核心用量和最近同步状态。<br><br>
      <img src="./assets/compact-usage-overview.png" alt="深色紧凑概览窗口，展示订阅配额、用量与同步状态" width="300">
    </td>
    <td width="50%" valign="top">
      <strong>桌面宠物</strong><br>
      选择角色、预览外观并调整大小，确认后设为当前宠物。<br><br>
      <img src="./assets/desktop-pet-settings.png" alt="宠物设置：当前宠物为 Clawd，正在预览大肥鱼，可调整大小或应用选择" width="100%">
    </td>
  </tr>
</table>

<details>
<summary>查看宽屏用量总览</summary>

![宽屏用量总览，包含统计卡片、订阅额度、年度活跃热力图和最近会话](./assets/usage-dashboard-wide.png)

</details>

## 🔌 数据源与能力范围

| 能力 | 已接入来源示例 | 使用说明 |
| --- | --- | --- |
| Token 与费用统计 | Claude Code、Codex、Cursor、Gemini CLI、OpenCode、GitHub Copilot、DeepSeek Harness、ZCode 等 | 基于各工具提供的日志、数据库或账单数据；可取得的字段与历史范围因来源而异 |
| 订阅额度 | Codex、Claude、Cursor、Copilot、Grok、Kimi、ZCode、Antigravity、Qoder、MiniMax、OpenCode、DeepSeek | 需要对应渠道的有效登录状态或配置；可显示的额度窗口与账户套餐有关 |
| 会话与任务统计 | Claude Code、Codex、Gemini CLI、OpenCode、Copilot、pi、OMP、DeepSeek Harness、Antigravity、ZCode、Kimi | 会话与 Token 采集范围分别计算；缺失或不完整的来源会显示覆盖提示 |

更多用量来源包括 OpenClaw、AutoClaw、Hermes、Roo Code、Droid、Kiro、Cline、Amp、Qwen Code、CodeBuddy、WorkBuddy、Grok Build、Mimo、Every Code、Kilo CLI、Kilo Code、Goose、Zed、Warp、WPS Comate、Command Code、MiniMax Code 和 KinetAios。完整工具目录见 [Core 数据源定义](./packages/core/src/tool-catalog.ts)。

用量采集、订阅额度和会话明细各有独立的数据覆盖范围。配置与口径见 [数据采集与统计](./docs/data-notes.md)、[订阅数据说明](./docs/subscription-plan-design.md)及 [额度管理](./docs/quota-management.md)。

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

用量数据在本机完成解析、聚合与查询，桌面端和 CLI 面板读取同一套本地统计。首次使用无需注册 Quotern 账号；供应商额度等在线读数仍需要对应服务可访问。

## 🛠️ 开发注意事项

仓库开发和测试使用 Node.js 22.13+，pnpm 版本以根 `package.json` 为准。在仓库根安装依赖：

```bash
corepack pnpm install --frozen-lockfile --prefer-offline
```

本地开发使用 `corepack pnpm dev:desktop` 或 `corepack pnpm dev:cli`。启动前请阅读 [worktree 开发规范](./docs/worktree-development.md)，实际面板地址以启动输出为准。

<details>
<summary>Electron 下载缓慢时配置镜像</summary>

Electron 二进制默认从 GitHub Releases 下载，国内网络可能会超时。可在安装前设置镜像环境变量：

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

</details>

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
- [Token Tracker](https://github.com/xiufengsun/TokenTracker): 多工具 Token 用量追踪与 Dashboard；本 README 的功能介绍与截图编排参考其[中文说明](https://github.com/xiufengsun/TokenTracker/blob/main/README.zh-CN.md)。
- [vibe-usage](https://github.com/vibe-cafe/vibe-usage): Token 使用量统计工具（CLI）
- [OpenUsage](https://github.com/robinebers/openusage): The Only AI Usage Tracker That's Truly Yours
- [agent-usage](https://github.com/briqt/agent-usage): 统一采集 Agent 的本地会话数据，通过 Web 仪表板展示 token 用量、费用趋势和会话明细。
- [ccusage](https://github.com/ccusage/ccusage): Coding Agent 用量分析 CLI。
- [models.dev](https://models.dev): 模型 Token 计价数据源，内置计价表由此增量同步
