# Quotern CLI 使用说明

需要 Node.js >= 20。

## 安装

```bash
npm i -g quotern
```

国内网络较慢时，可使用镜像源：

```bash
npm i -g quotern --registry=https://registry.npmmirror.com/
```

也可免安装直接用 `npx`：

```bash
# 后台常驻（推荐，支持开机自启）
npx quotern service start

# 前台运行（当前终端占用，方便看日志，Ctrl+C 停止）
npx quotern start

# 面板: http://127.0.0.1:8452
```

## 快速开始

推荐用后台服务启动（常驻，支持开机自启，macOS / Windows / Linux）：

```bash
quotern service start
# 面板: http://127.0.0.1:8452
```

Linux 后台服务依赖 systemd 用户实例（`systemctl --user`）。无 systemd 时改用 `quotern start` 前台运行。

Windows 注册开机自启需要管理员权限：建议在「以管理员身份运行」的终端中执行 `quotern service start`。首次注册失败会导致命令失败，可改用 `quotern start` 前台运行；已有服务运行时补注册失败只警告，不影响该服务。

首次启动会写入数据目录 `~/.ai-usage/`，尝试注册 Claude / Codex Hook，并同步本地用量。

常用管理：

```bash
quotern service status
quotern service stop
quotern status
```

需要前台运行（当前终端占用、方便看日志）时再用：

```bash
quotern start
# Ctrl+C 停止
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `quotern service <action>` | **推荐** 后台服务与开机自启；`action`: `start` \| `stop` \| `status` |
| `quotern` / `quotern start` | 前台启动本地面板与同步 |
| `quotern stop` | 停止当前进程内的前台服务 |
| `quotern status` | 查看 CLI / 面板当前状态 |
| `quotern sync` | 手动同步本地用量数据 |
| `quotern doctor` | 检查运行环境、本地数据源及服务状态 |
| `quotern usage [period]` | 只读查询已采集用量，支持文本、JSON、CSV |
| `quotern help` | 显示帮助 |

## 常用选项

```bash
quotern start --port 8452
quotern start --host 0.0.0.0          # 局域网可访问；默认 127.0.0.1
quotern sync --source=claude          # claude | codex | cursor | all
```

## 用量报表与 Agent 查询

```bash
quotern usage                         # 最近 7 天，包含今天
quotern usage daily --days 30
quotern usage weekly --from 2026-06-01 --to 2026-06-30
quotern usage monthly --days 90 --csv
quotern usage models --source codex,claude --days 30 --json
quotern usage projects --project Quotern --days 30 --format json
```

`period` 支持 `summary`、`daily`、`weekly`、`monthly`、`models`、`projects`。日期以 `Asia/Shanghai` 划分，包含起止日，周一为一周起点。`--days` 接受 1–3660；与成对的 `--from/--to` 互斥。筛选支持逗号分隔的 `--source`、完整模型名 `--model` 和项目显示名 `--project`。同名项目目录沿用面板合并口径；模型仍保留 Agent 身份。

命令直接读取本地配置、统计队列和已有价格缓存，Desktop 运行时也可使用；不会启动服务、同步原始日志或扩大采集范围。默认目录为 `~/.ai-usage/`，`--data-dir <目录>` 可显式选择已有数据。缺配置或非法参数退出码为 1；空结果正常返回。数据为读取时已落盘的快照，同步正在进行时与面板读数可能有短暂差异。

JSON 使用 `schemaVersion: 1`，包含 `summary`、`rows`、`filters` 和 `coverage`。先检查采集起点、`limited`、最近同步时间；请求的日期范围早于采集起点时，结果不代表完整历史。费用的 `costUsd: null` 表示部分价格未知，`knownCostUsd` 仅为已计价小计；CSV 对未知费用/请求数/缓存率留空。`costExplanation` 提供来源报告金额、按费率估算、默认费率占比、缺失价格、实际匹配模型和 Token 依据。费用均不能直接解释为实际付款。

Agent 可使用随 npm 包分发的 [quotern-usage Skill](./packages/cli/skills/quotern-usage/SKILL.md)。将该 `quotern-usage` 文件夹复制到所用 Agent 的技能目录（例如项目 `.agents/skills/`），或从已安装的 `quotern/skills/quotern-usage` 复制。Skill 只调用上述 JSON 查询，不维护第二套解析器，也不会隐式启动或修复服务。

## 数据与同步

- 数据目录：`~/.ai-usage/`
- 更名后沿用已有统计与设备身份；注册或停止后台服务时会清理旧名称的自启项。
- Claude / Codex：Hook 写入信号，由常驻进程调度同步；另有后台轮询补充
- Cursor：轮询模式（无 Hook）
- 本机用量保存在本地统计队列。

调试日志：`~/.ai-usage/logs/notify.log`、`~/.ai-usage/logs/sync.log`。

采集范围、增量规则与后台恢复见[运行维护注意事项](./docs/runtime-notes.md)。
