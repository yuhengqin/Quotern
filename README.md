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
  <a href="#本地数据">本地数据</a>
</p>

## 🖥️ 客户端使用

Quotern 提供 macOS / Windows 桌面客户端，安装即用，无需额外配置。

### 下载安装

前往 [Releases](https://github.com/yuhengqin/Quotern/releases) 页面下载对应系统的安装包（macOS 按芯片选 `.dmg`，Windows 选 `.exe`），安装即用。

> 💡 macOS 提示「已损坏」？在终端执行 `sudo xattr -dr com.apple.quarantine` 后把应用拖入终端窗口即可。

### 首次启动

1. 打开 **Quotern** 应用
2. 首次运行会自动尝试注册 Claude / Codex Hook 并同步本地用量
3. 面板将自动弹出，展示用量趋势、模型分布等数据

如未检测到 Claude / Codex 等 Agent，请确认已安装并使用过至少一次。

用量数据保存在本机，面板直接读取本地统计。

## ⌨️ CLI 使用

需要 Node.js >= 20。macOS / Windows / Linux 安装后后台启动即可打开本地面板：

```bash
npm i -g quotern
quotern service start
# 面板: http://127.0.0.1:8452
```

国内网络较慢可用 `npm i -g quotern --registry=https://registry.npmmirror.com/`。完整命令、选项与数据说明见 [CLI 使用说明](./CLI.md)。

## 本地数据

统计数据保存在 `~/.ai-usage/`，包含 Token 数值、来源、模型和项目归属等信息。Quotern 更名后继续读取这一目录，以保留已有统计。解析器读取 Agent 日志或数据库后保存统计桶；配置中还保存本机设备标识等运行信息。

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

- [Token Tracker](https://github.com/xiufengsun/TokenTracker): 自动采集 30 款 AI 编码工具 的 token 用量，用一套漂亮的 Dashboard 看真实成本与趋势。
- [vibe-usage](https://github.com/vibe-cafe/vibe-usage): Token 使用量统计工具（CLI）
- [OpenUsage](https://github.com/robinebers/openusage): The Only AI Usage Tracker That's Truly Yours
- [models.dev](https://models.dev): 模型 Token 计价数据源，内置计价表由此增量同步
