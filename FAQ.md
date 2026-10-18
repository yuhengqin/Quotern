# 常见问题

### 客户端提示 `LOCAL_RUNTIME_NOT_READY` 怎么办？

关窗口不会退出（会留在托盘）。先从托盘点 **退出**，再按下面的 case 排查。

**Case 1：刚启动 / 刚自动更新**

等 2 秒，从托盘退出后重开。不要在更新过程中刷新。

- macOS：菜单栏图标 → 右键 **退出**
- Windows：任务栏右下角托盘（可能在 `^` 里）→ **退出**

**Case 2：同时开着 CLI**

```bash
npx quotern@latest service stop
```

然后重开桌面端。

**Case 3：`config.json` 格式坏了（parse 失败）**

```bash
# macOS / Linux
python3 -m json.tool ~/.quotern/config.json
# 修不好则备份后让应用重建配置
mv ~/.quotern/config.json ~/.quotern/config.json.bak
```

```powershell
# Windows
python -m json.tool $env:USERPROFILE\.quotern\config.json
Move-Item $env:USERPROFILE\.quotern\config.json $env:USERPROFILE\.quotern\config.json.bak
```

修好或改名后，托盘退出再打开。

**Case 4：残留进程 / 锁文件**

先运行 `quotern doctor`、`quotern service status`，核对 `~/.quotern/tud.pid` 中的 PID 与实际进程。通过托盘退出桌面端、用 `quotern service stop` 停止 CLI；确认对应进程已经退出后，再处理残留 PID 文件并重开。不要仅凭命令行含仓库名批量终止进程，IDE 插件进程也可能包含该路径。

日志：macOS / Linux `~/.quotern/logs/`，Windows `%USERPROFILE%\.quotern\logs\`。进程识别和恢复规则见[运行维护注意事项](./docs/runtime-notes.md)。

### Linux 上 `quotern service start` 失败？

CLI 后台服务在 Linux 上走 systemd 用户服务。若提示 `systemctl --user` 不可用，可改用前台运行：

```bash
quotern start
```

WSL 需先启用 systemd。在 `/etc/wsl.conf` 写入：

```
[boot]
systemd=true
```

然后执行 `wsl --shutdown`，再打开发行版。

排障：

```bash
journalctl --user -u quotern
# 以及
less ~/.quotern/logs/daemon.log
```
