# 给 Agent 安装助手的说明

本文件用于安装 Quotern 的 `quotern-usage` Skill。用量查询的运行时入口是 [SKILL.md](./packages/cli/skills/quotern-usage/SKILL.md)。

## 1. 确定来源、Agent 与安装范围

- 根据用户请求确定目标 Agent，以及项目级或个人全局安装。未指定范围时使用当前目标项目；不要将分发仓库自动当作目标项目。
- 用户明确要求全局安装时使用 `--global`，否则在目标项目目录执行安装命令。
- 已检出本仓库时，源为本文件所在仓库的 `packages/cli/skills/quotern-usage/`，使用它的真实绝对路径。只有远程来源时使用 `yuhengqin/Quotern`，并保留 `--full-depth` 以发现嵌套目录。
- 识别当前 Agent 的安装器 ID，例如 `codex`、`claude-code`、`cursor`；不要默认安装到所有检测到的 Agent。其他客户端的 ID 与发现路径按 [安装器支持列表](https://github.com/vercel-labs/skills#supported-agents) 核实。
- 安装器当前要求 Node.js >= 22.20。先检查 `node --version`、`npm --version`。缺少运行环境时说明缺项，不静默安装 Node.js。

## 2. 使用跨工具安装器

先确认源包含 `SKILL.md`、`references/`、`scripts/`、`assets/`。检查目标是否已有同名 Skill；存在时先比较内容及链接实际目标，保留未经授权覆盖的本地定制，不用删除目录再安装的方式解决冲突。

从远程仓库安装前，先验证可发现性：

```bash
npx --yes skills add yuhengqin/Quotern --list --full-depth
```

输出应列出 `quotern-usage`。为当前 Agent 全局安装时，将下面的 `<agent-id>` 替换为已确认的 ID：

```bash
npx --yes skills add yuhengqin/Quotern --skill quotern-usage --full-depth --global --agent <agent-id> --yes
```

使用本地源码时，将 `yuhengqin/Quotern` 替换为加引号的 Skill 绝对目录，省略 `--full-depth`；项目级安装时去掉 `--global`，并在目标项目运行。外层 `npx --yes` 处理 npm 下载确认，末尾 `--yes` 处理安装器确认，仅在安装目标和范围已确定后使用。

推荐安装器默认的链接方式。全局 Skill 的实体通常位于 `~/.agents/skills/quotern-usage/`；Claude Code 等客户端使用各自目录中的链接，Windows 为 Junction。发现路径已直接使用共享目录的 Agent 无需额外链接。客户端配置可改变目标路径，以实际安装输出为准。

网络或权限失败时，报告具体失败；已有本地检出时可使用本地源。安装器无法使用时，按 [README 的备用方法](./README.md#手动复制备用) 复制完整文件夹，保留相对结构和许可证。不要仅复制 `SKILL.md`。

## 3. 验证安装

1. 用 `npx skills list --global --agent <agent-id>` 检查全局安装；项目级安装去掉 `--global` 并在目标项目运行。确认输出包含 `quotern-usage`。
2. 读取实际发现路径中的 `SKILL.md`，确认名称为 `quotern-usage`。如为链接，核对其实际目标。
3. 与安装来源逐文件比较内容或 SHA-256，确认 `references/`、`scripts/`、`assets/` 一并安装，保留字体许可证 `assets/JetBrainsMono-OFL.txt`。
4. 对安装后的脚本运行 `node --check "<已安装 Skill 绝对目录>/scripts/render-report.mjs"`，检查退出状态，并确认报告模板、字体及图标资源可读。此检查只验证脚本语法与文件完整性，不代表已生成报告。
5. 运行 `quotern usage --help`，确认查询命令可用。若 CLI 未安装，说明 Skill 安装结果与 CLI 缺项，并提供 `npm i -g quotern`；只有用户授权安装 CLI 时才执行。Quotern CLI 的最低 Node.js 版本为 20.10，与安装器要求不同。

安装验证不需要运行 `start`、`service`、`sync`，也不需要读取真实个人用量。若用户尚未通过 Desktop 或 CLI 完成首次同步，说明后续查询需要已有本地采集数据，不为安装隐式启动采集。

检查客户端是否列出该 Skill；若无法观察客户端的技能列表或实际触发行为，分别报告“安装器已发现并安装”和“客户端加载/自动触发未验证”。按客户端要求刷新技能或重开会话，不把文件已存在等同于自动触发成功。

## 4. 交付结果

简要列出安装范围、目标 Agent、真实源与目标路径、链接或复制方式、执行的检查和未验证事项。首次使用可向 Agent 提问：

> 请使用 quotern-usage 查看我最近 7 天的用量信息。

更新时先比较新旧内容并保留本地定制，再复验受影响内容；不要自动重装其他 Skill 或改写项目指令。
