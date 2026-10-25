# 会话本机操作

在现有会话详情中增加“继续会话”和“打开项目目录”，保留复制恢复命令、复制目录、指标、导出和上下文审计。请求只携带来源、会话 ID 与固定操作名；运行端从已采集日志读取目录，从固定命令表生成 argv，校验目录存在后调用系统。

采用 Core 共享本机操作接口，供 CLI HTTP 与 Desktop IPC 使用。浏览器直接打开 file URL 无法可靠启动终端；自定义协议还需注册系统处理器，因此本次不采用这两条路径。

本机操作仅对 loopback 面板及 Desktop 的内部 API 开放；跨站来源、远程 Host、缺失动作令牌、非 JSON、额外字段及非法 ID 均拒绝。客户端不能指定目录、可执行程序或 shell 文本。命令入口从绝对 PATH 目录解析，避免执行项目内同名文件。

Windows 创建新 console，使用系统默认终端宿主承载 PowerShell，并安全传递目录与固定恢复命令；这不等同于读取 Windows Terminal 默认 profile。macOS 使用系统 Terminal，Linux 使用 x-terminal-emulator。错误明确区分目录不可用、CLI 未安装和启动失败；“已打开终端”只确认启动请求，不声称 Agent 已成功恢复。

以当前 Windows 环境实测文件管理器和受控恢复程序；macOS/Linux 通过启动契约测试，保留未实测说明。开发基于 codex/session-insights 的 5f188b7b，使用独立 worktree 与服务，不重启已有 8452/8453 实例。
