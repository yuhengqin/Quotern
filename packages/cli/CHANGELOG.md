# quotern

按版本记录与当前维护范围相关的变更；现行使用方式和限制见[本包 README](./README.md)。

## 0.1.13

### Patch Changes

- 新增 MiniMax Code、WPS 灵犀（WPS Comate）用量采集与面板展示。
- 修复 OpenCode 2.0 新用量未统计、CodeBuddy 多轮工具调用只计最后一轮、以及休眠后缺失日期不显示。
- 内置面板：WorkBuddy 改用官方品牌图标。
- Cursor 用量 CSV 超时跳过本轮、未登录时停止拉账单；启动时不再误杀带仓库名的 IDE 插件进程。
- Updated dependencies
  - quotern-core@0.1.13

## 0.1.12

### Patch Changes

- 概览卡副文案展示请求数与缓存命中率。
- 支持 CodeBuddy 扩展 / 新版 Cline；修复 DSH 同步卡死、Hermes 用量日期、ZCode 解析与 reasoning 合计、Codex 账本补齐、JSONL 半截行丢失。
- 修复 Windows 上 Claude Code `notify.cmd: command not found`；旧 hook 下次启动时自动更正。
- Updated dependencies
  - quotern-core@0.1.12

## 0.1.11

### Patch Changes

- 新增 `quotern doctor` 诊断指令，用于一站式排查运行环境、数据目录权限、本地数据源探测和进程锁，并在异常时给出解决指引。
- 新增 AutoClaw 用量采集与项目归属；修复 WorkBuddy 项目归属，并对仍有旧 unknown 项目记录的数据执行一次重扫。
- 修复 Cursor App 与 Cursor CLI 登录了不同账号时，本地用量停止更新的问题。
- 内置面板：AutoClaw 改用官方品牌图标。
- Updated dependencies
  - quotern-core@0.1.11

## 0.1.10

### Patch Changes

- 新增 Command Code、QwenWork（含国内版/国际版）用量采集，并支持从环境变量与 CC Switch 配置发现 Codex 家目录。
- 修复 Copilot CLI、OpenCode、WorkBuddy 的项目归属，以及 DeepSeek Harness 带版本会话文件与思考 Token 采集。
- `quotern sync --source` 对 `all` / 未知数据源有明确契约，不再静默同步 0 条却显示成功；帮助列表补上 `dsh`。
- 启动前拒绝缺失、非整数或超出范围的 `--port`，不再静默回退或吞掉后续参数。
- Windows：`quotern service start` 因缺少管理员权限无法注册开机自启时给出明确指引；服务已在运行时补注册失败改为警告，不再中断命令。
- 修复 Windows 上本地服务占用判定依赖已移除的 `wmic`、环境变量盘符被切断，以及并发写 `config.json` 易失败的问题。
- 统一面板卡片汇总、工具筛选和趋势比较口径；修复 Token 趋势「详细」视图缓存过大时把输入画成 0。
- Updated dependencies
  - quotern-core@0.1.10

## 0.1.9

### Patch Changes

- 新增 GPT-6 Astra 的官方 Token 定价，并补上缓存读取与缓存写入单价；命中缓存的输入 Token 不再按 0 计费。
- 修复后台同步完成时覆盖较新配置的问题，并避免保存配置时回退最近同步时间。
- 修复把面板时间范围从 7 天扩大到 30 / 90 天后 Token、费用和会话数被重复计算的问题：扩大范围触发的历史重扫改为用重扫结果覆盖已有数据，不再和旧数据相加。
- 内置面板：主题切换收敛为单个按钮，支持跟随系统。
- Updated dependencies
  - quotern-core@0.1.9

## 0.1.8

### Patch Changes

- 新增 DeepSeek Harness（dsh）用量采集：读取本地 `~/.dsh` 会话，按消息增量统计 token、模型与项目。
- 定价表补充 Claude Fable 5.1 与 Gemini 3.8 Flash，费用统计按最新价格计算。
- 修复项目分布把工作目录编码路径（如 `%2FUsers%2F...`）直接当标题展示的问题。CLI、Web 与 Desktop 面板同步修复。
- Updated dependencies
  - quotern-core@0.1.8

## 0.1.7

### Patch Changes

- CLI 支持 `--host` 指定面板监听地址（默认 127.0.0.1；局域网访问可用 0.0.0.0）。
- 新增 Linux systemd 用户服务，便于后台自启；注册失败时回滚残留 unit，并避免将未启用的服务误报为已注册。
- 修复 Desktop、CLI 与 Web 面板每日趋势费用刻度被裁切，较大金额现在可完整显示。
- 后台同步更轻：空轮询不再全量扫描，定价改为启动时拉取一次。
- 手动同步后弹出成功或失败 Toast。
- Updated dependencies
  - quotern-core@0.1.7

## 0.1.6

### Patch Changes

- 内置面板：用量页时间范围刷新后仍保留上次选择。
- 筛选栏补充 GitHub 仓库入口。
- 同步 core 的定价表增量更新与模型匹配增强，修复 Cursor 模型被误判为 MiniMax 导致费用偏高。
- Updated dependencies
  - quotern-core@0.1.6

## 0.1.5

### Patch Changes

- 桌面端在线时 CLI start 进入观察模式，不抢占常驻采集 runtime。
- Updated dependencies
  - quotern-core@0.1.5

## 0.1.4

### Patch Changes

- 定价覆盖层启动时等待首次拉取并落盘缓存，刷新后重建本地聚合缓存。
- Updated dependencies
  - quotern-core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies
  - quotern-core@0.1.3

## 0.1.2

### Patch Changes

- 本地采集窗口扩到 90 天。
- Updated dependencies
  - quotern-core@0.1.2

## 0.1.1

### Patch Changes

- 改进 `quotern service start` 的启动可靠性，修复 PID 时间戳误判和写盘时序问题，并增加 `/health` 兜底检查。
- 升级内部依赖至 `quotern-core@0.1.1`，并合并 beta 阶段的稳定性修复后发布正式版。

## 0.1.1-beta.9

### Patch Changes

- fix: `quotern service start` 不再因 PID 时间戳误判 / 写盘过晚而报超时，并以 `/health` 作为就绪兜底
- fix: cli 启动检测失败问题
- Updated dependencies
  - quotern-core@0.1.1-beta.9

## 0.1.1-beta.8

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.8

## 0.1.1-beta.7

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.7

## 0.1.1-beta.6

### Patch Changes

- fix: reefresh
- Updated dependencies
  - quotern-core@0.1.1-beta.6

## 0.1.1-beta.5

### Patch Changes

- Updated dependencies
  - quotern-core@0.1.1-beta.5

## 0.1.1-beta.4

### Patch Changes

- chore: update
- Updated dependencies
  - quotern-core@0.1.1-beta.4

## 0.1.1-beta.3

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.3

## 0.1.1-beta.2

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.2

## 0.1.1-beta.1

### Patch Changes

- chore: init
- Updated dependencies
  - quotern-core@0.1.1-beta.1

## 0.1.1-beta.0

### Patch Changes

- chore: init
- Updated dependencies
  - quotern-core@0.1.1-beta.0
