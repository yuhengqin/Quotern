---
"quotern": major
"quotern-core": major
"quotern-dashboard": minor
"quotern-desktop": minor
---

**Breaking:** 项目统一更名为 Quotern。CLI 命令及 npm 包名改为 `quotern`，内部包改为无 scope 的 `quotern-core`、`quotern-dashboard` 和 `quotern-desktop`；同步更新界面、安装指引、构建与发版配置。旧 CLI 用户应先停止旧后台服务并卸载原全局包，再安装 `quotern` 并运行 `quotern service start`；直接引用核心库的用户应更新 import 为 `quotern-core`。

保留现有统计数据、设备身份和桌面偏好。后台服务使用新名称，注册或停止服务时会清理旧名称的自启项，升级期间仍可识别旧版本进程。
