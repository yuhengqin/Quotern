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
| `quotern help` | 显示帮助 |

## 常用选项

```bash
quotern start --port 8452
quotern start --host 0.0.0.0          # 局域网可访问；默认 127.0.0.1
quotern sync --source=claude          # claude | codex | cursor | all
```

## 数据与同步

- 数据目录：`~/.ai-usage/`
- 更名后沿用已有统计与设备身份；注册或停止后台服务时会清理旧名称的自启项。
- Claude / Codex：Hook 写入信号，由常驻进程调度同步；另有后台轮询补充
- Cursor：轮询模式（无 Hook）
- 本机用量保存在本地统计队列。

调试日志：`~/.ai-usage/logs/notify.log`、`~/.ai-usage/logs/sync.log`。

采集范围、增量规则与后台恢复见[运行维护注意事项](./docs/runtime-notes.md)。
