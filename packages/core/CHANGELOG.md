# quotern-core

按版本记录与当前维护范围相关的变更；现行使用方式和限制见[本包 README](./README.md)。

## 0.1.13

### Patch Changes

- 新增 MiniMax Code 用量采集：读取本机 MiniMax Code 会话，按项目目录归属；可用 `quotern sync --source=minimax-code`（别名 `mcode` / `minimax`）。
- 新增 WPS 灵犀（WPS Comate）用量采集：读取 `~/.wpscomate` 会话日志，按工作目录归属项目。
- 修复 OpenCode 2.0 及之后新产生的用量没有进入统计：下次同步补齐尚未记过的模型调用与上下文压缩，已统计历史不重复计算。
- 修复 CodeBuddy 用量偏低：多轮工具调用按整轮累计 token，不再只计最后一轮。
- 修复应用休眠或停用多天后，已有用量日期不出现在本地面板：启动时补齐缺失的历史缓存日期。
- Cursor 用量 CSV 下载超时则跳过本轮采集，避免中断整轮同步；未登录时停止拉取账号账单，已采集历史保留。
- 收紧桌面进程匹配，避免启动时误杀 Cursor / VS Code 等带仓库名的 IDE 插件进程。
- 内置定价表补充 Claude Opus 5.5、GPT-6 Sol/Luna、小米 Mimo v2.6，并更新通义千问国内区价格。

## 0.1.12

### Patch Changes

- 支持读取 CodeBuddy 桌面应用与 VSCode / Cursor 插件的用量数据，并按项目目录归属；补充腾讯 hy4-preview 定价与 codebuddy「auto」模型别名。
- Codex 会话迁入数据库后删除的历史文件用量，改为按线程账本累计总量补齐；历史文件仍在时按文件拆分，账本只补差额。
- 修复 Desktop 同步 DSH 时 `tud-sync-worker` 100% CPU 永久卡死：多帧 zstd 改用纯 JS 解码器。首次同步大体积会话可能多花约十秒，日常增量不受影响。
- 修复新版 Cline 用量无法采集：新增读取 `~/.cline/data/sessions` SDK 会话，同时保留旧版 VS Code globalStorage 逻辑。
- 修复 Hermes Agent 用量被记到「会话开始那天」：改为按最后一次活动时间归集。已写入历史不会自动重排；扩大时间范围触发全量重扫时日分布可能变化。
- 修复新版 ZCode 不再记录 token：兼容 `providerId`，并优先读取 `model_usage` 表（修正缓存 token 双倍计入）；旧版仍回退 message 表。
- 修复 zcode「总 Token」少算 reasoning：面板按五项明细求和，并自愈存量 zcode 桶。
- 修复同步撞上日志写入中途时，半截记录被跳过后永久丢失：游标停在最后一条完整记录。
- 概览卡副文案展示请求数与缓存命中率；请求数优先用本地请求证据，其余渠道回退 conversation 计数。
- 修复 Windows 上 Claude Code `notify.cmd: command not found`；旧 hook 下次启动时自动更正。
- 内置定价表同步 models.dev 官方渠道价格，含 Grok 4.7 与近期 GLM 模型。

## 0.1.11

### Patch Changes

- 新增 AutoClaw 用量采集：读取 `~/.openclaw-autoclaw*`（或 `AUTOCLAW_STATE_DIR`）下的会话，与 OpenClaw 同格式；此前只设了 `OPENCLAW_STATE_DIR` 的用户，AutoClaw 数据无法被统计。
- AutoClaw 项目归属改为从消息里的绝对路径向上找仓库根；没有路径时沿用上一项目，最后回退到 agent 显示名。
- 修复 WorkBuddy 项目归属，并对仍有旧 unknown 项目记录的数据执行一次重扫。
- 新增 `quotern doctor` 诊断：排查运行环境、数据目录权限、本地数据源探测和进程锁，异常时给出解决指引。
- 修复 Cursor App 与 Cursor CLI 登录了不同账号时，本地用量和额度卡停止更新的问题。
- 内置定价表同步近期 Qwen 3.8 Flash、DeepSeek Flash 等官方渠道价格。

## 0.1.10

### Patch Changes

- 新增 Command Code 用量采集：读取 `~/.commandcode/projects` 下的会话 JSONL，用于本地面板统计。
- 新增 QwenWork 用量采集：读取 `~/.qwenwork` 与 `~/.qwenworkcn` 会话日志，国内版/国际版一并计入。
- Codex 会扫描环境变量与 CC Switch 配置的家目录，并读取其中的会话与归档会话。
- 修复 WorkBuddy 用量全部归到 `unknown` 项目的问题，改为按会话工作目录解析真实项目名。
- 修复 Copilot CLI 增量续读把跨轮询会话归到 `unknown`、扩大时间范围后又与真实项目重复计数的问题。
- 修复 OpenCode 会话项目名全部显示为 `unknown` 的问题。
- 修复 DeepSeek Harness 用量采集：兼容 `session.v3.jsonl.zstd` 等带版本会话文件，并支持思考模型 Token。
- `quotern sync --source` 与本地 API 的数据源参数有明确契约：`all` 等同全量；未知数据源 CLI 非零退出、API 返回 400，不再静默同步 0 条却显示成功。帮助列表补上 `dsh`。
- 统一托盘、CLI 与 Desktop 面板的卡片汇总、工具筛选和趋势比较口径；趋势改为与紧邻的等长上一周期比较，今天按昨天同期计算。
- 修复 Token 趋势「详细」视图在缓存远大于未缓存输入时把输入画成 0 的问题。
- 修复 Windows：不再依赖已移除的 `wmic` 判断本地服务占用；`AI_USAGE_*_ROOTS` 不再在盘符冒号处被切断；并发写 `config.json` 会先重试再放弃。

## 0.1.9

### Patch Changes

- 新增 GPT-6 Astra 的官方 Token 定价，并补上缓存读取（$1 / 百万 Token）与缓存写入（$12.5 / 百万 Token）单价；命中缓存的输入 Token 不再按 0 计费，Codex 等来源的费用不再明显偏低。
- 修复后台同步完成时覆盖较新配置的问题，并避免保存配置时回退最近同步时间。
- 修复把面板时间范围从 7 天扩大到 30 / 90 天后 Token、费用和会话数被重复计算的问题：扩大范围触发的历史重扫改为用重扫结果覆盖已有数据，不再和旧数据相加；Desktop 的同步进程也会在主进程清空 cursor 后丢弃自己的缓存，保证补扫真的执行。

## 0.1.8

### Patch Changes

- 新增 DeepSeek Harness（dsh）用量采集：读取本地 `~/.dsh` 会话，按消息增量统计 token、模型与项目。
- 定价表补充 Claude Fable 5.1 与 Gemini 3.8 Flash，费用统计按最新价格计算。
- 修复项目分布把工作目录编码路径（如 `%2FUsers%2F...`）直接当标题展示的问题。

## 0.1.7

### Patch Changes

- 降低后台同步占用：Desktop 将解析放到独立进程，空轮询不再全量扫描，定价改为启动时拉取一次。

## 0.1.6

### Patch Changes

- 内置定价表按 models.dev 官方渠道增量同步，手工补充的模型价保留不丢。
- 定价匹配增强：Claude 模型名归一化、推理档后缀剥离，精确命中优先于 fuzzy 兜底。
- 修复 Cursor 模型被误判为 MiniMax 导致费用偏高。

## 0.1.5

### Patch Changes

- 新增 runtime 心跳与 ownership 监督，僵死 / 过期 owner 可被识别并清掉。
- `config.json` 损坏时自动备份并重建，尽量恢复设备 ID。

## 0.1.4

### Patch Changes

- Codex / Every Code 将 unknown 模型用量并入同期主导已知模型，减少 unknown 分桶。
- 定价覆盖层落盘缓存，启动可复用上次成功拉取的表，刷新后重建聚合缓存。
- 聚合费用统一按 8 位小数累加，避免分桶先四舍五入到分造成误差。

## 0.1.2

### Patch Changes

- 本地采集窗口扩到 90 天。

## 0.1.1

### Patch Changes

- 改进 `quotern service start` 的启动就绪判断，修复 PID 时间戳误判和写盘时序导致的误超时，并增加 `/health` 兜底检查。
- 汇总 beta 阶段的稳定性修复，并发布首个 `0.1.1` 正式版。

## 0.1.1-beta.9

### Patch Changes

- fix: `quotern service start` 不再因 PID 时间戳误判 / 写盘过晚而报超时，并以 `/health` 作为就绪兜底
- fix: cli 启动检测失败问题

## 0.1.1-beta.8

### Patch Changes

- fix: some bugs

## 0.1.1-beta.7

### Patch Changes

- fix: some bugs

## 0.1.1-beta.6

### Patch Changes

- fix: reefresh

## 0.1.1-beta.4

### Patch Changes

- chore: update

## 0.1.1-beta.3

### Patch Changes

- fix: some bugs

## 0.1.1-beta.2

### Patch Changes

- fix: some bugs

## 0.1.1-beta.1

### Patch Changes

- chore: init

## 0.1.1-beta.0

### Patch Changes

- chore: init
