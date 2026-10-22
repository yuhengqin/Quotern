# Quotern CLI

本地优先的 AI Agent Token 用量看板：采集 Claude / Codex / Cursor 用量，启动本地面板，全部数据保存在本机。

## 安装

需要 Node.js >= 20。

```bash
npm i -g quotern
```

## 快速开始

推荐用后台服务启动（常驻，支持开机自启，macOS / Windows / Linux）：

```bash
quotern service start
# 面板: http://127.0.0.1:8252
```

Linux 后台服务依赖 systemd 用户实例（`systemctl --user`）。无 systemd 时改用 `quotern start` 前台运行。

首次启动会写入数据目录 `~/.quotern/`，尝试注册 Claude / Codex Hook，并同步本地用量。

常用管理：

```bash
quotern service status
quotern service stop
quotern status                 # 查看面板与同步状态
```

需要前台跑（当前终端占用、方便看日志）时再用：

```bash
quotern start                  # 或直接 quotern
# Ctrl+C 停止
```

## 命令

| 命令 | 说明 |
|------|------|
| `quotern service <action>` | **推荐** 后台服务与开机自启；`action`: `start` \| `stop` \| `status` |
| `quotern` / `quotern start` | 前台启动本地面板与同步 |
| `quotern stop` | 停止当前进程内的前台服务 |
| `quotern status` | 查看 CLI / 面板当前状态 |
| `quotern sync` | 手动同步本地用量数据 |
| `quotern doctor` | 检查运行环境、本地数据源及服务状态 |
| `quotern help` | 显示帮助 |

## 常用选项

```bash
quotern service start
quotern start --port 8252
quotern start --host 0.0.0.0          # 局域网可访问；默认 127.0.0.1
quotern sync --source=claude          # 指定数据源；all 为全部
quotern sync --source=minimax-code    # MiniMax Code 桌面端 / mcode CLI（别名：mcode）
```

默认端口为 `8252`。已有 `~/.quotern/config.json` 中的 `serverPort` 会继续生效；显式 `--port` 优先于已保存配置。需要切换已有实例时，先退出前台实例或运行 `quotern service stop`，再执行 `quotern start --port 8252` 或 `quotern service start --port 8252`，新端口会保存到配置中。

## 数据与同步

- 数据目录：`~/.quotern/`
- Claude / Codex：Hook 写入信号，由常驻进程调度同步；另有后台轮询补充
- Cursor：轮询模式（无 Hook）
- 本机用量保存在本地统计队列。

调试日志：`~/.quotern/logs/notify.log`、`~/.quotern/logs/sync.log`。

服务注册、观察模式与排障边界见[运行维护注意事项](../../docs/runtime-notes.md)。

## License

MIT
