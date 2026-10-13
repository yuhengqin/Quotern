# quotern-desktop

按版本记录与当前维护范围相关的变更；现行使用方式和限制见[本包 README](./README.md)。

## 0.1.13

### Patch Changes

- 主面板和托盘新增 Copilot 套餐剩余额度、内联建议与重置时间，按本机登录账号匹配，避免多账号混用。
- 新增 MiniMax Code、WPS 灵犀（WPS Comate）用量采集；MiniMax 额度卡支持新版桌面客户端 / mcode CLI。
- 修复 ZCode 额度卡在智谱账号下不显示，并区分国内 / 国际账号；Codex 额度失败时显示原因和重试，未使用 ChatGPT 订阅时隐藏卡片。
- 修复静默启动后再打开不显示窗口，以及原生崩溃后进程卡死无法重新打开。
- 修复 Windows 便携版自动更新后变成普通安装版：便携版只提示新版本，引导到发行版页面手动下载。
- 修复 OpenCode 2.0 新用量、CodeBuddy 整轮 token，以及休眠后缺失日期不显示。
- WorkBuddy 改用官方品牌图标。
- Updated dependencies
  - quotern-core@0.1.13

## 0.1.12

### Patch Changes

- 概览卡下方展示本机订阅额度卡片，可在设置中选择显示哪些渠道（默认开启；为空的渠道仍自动隐藏）；套餐档位与重置/到期时间展示更清晰。
- 概览卡副文案展示请求数与缓存命中率。
- 修复 Desktop 同步 DSH 时 worker 100% CPU 卡死；同步 worker 内置 5 分钟硬看门狗，卡死后自动重启。
- 支持 CodeBuddy 扩展与新版 Cline SDK 用量；修复新版 ZCode 不记 token、以及 zcode 总 Token 少算 reasoning。
- 修复 Hermes 用量日期、JSONL 半截行丢失，以及 Codex 账本补齐迁库后被删历史文件的用量。
- 修复 Windows 上 Claude Code `notify.cmd: command not found`。
- Updated dependencies
  - quotern-core@0.1.12

## 0.1.11

### Patch Changes

- macOS 菜单栏托盘默认同时显示今日 Token 和金额，随数据同步更新；可在「应用设置」中选择仅 Token、仅金额或两者，也可关闭显示。
- 新增 AutoClaw 用量采集与项目归属；修复 WorkBuddy 项目归属，并对仍有旧 unknown 项目记录的数据执行一次重扫。
- AutoClaw 在「工具与模型用量」等统计图标处改用官方品牌图标。
- 修复 Cursor App 与 Cursor CLI 登录了不同账号时，本地用量和额度卡停止更新的问题。
- 修复设置面板「关于」等标签页内容被裁切、无法滚动到底的问题。
- 修复对本机已安装或应用内附带的 Codex、Claude、Grok CLI 订阅额度采集不完整的问题。
- Updated dependencies
  - quotern-core@0.1.11

## 0.1.10

### Patch Changes

- 新增 Command Code、QwenWork 用量采集与面板展示。
- macOS 托盘增加本机订阅/额度卡片：Codex、DeepSeek 余额、MiniMax Code、OpenCode Go、TRAE；WorkBuddy 卡片在官方额度接口确认前不会向外发送凭据。ZCode 可从 OpenCode `auth.json` 读取备用凭据。
- 统一托盘与主面板的卡片汇总、工具筛选和趋势比较口径。
- 修复 Token 趋势「详细」视图缓存过大时把输入画成 0；修复未勾选复选框在深色模式几乎不可见，以及白底徽章上 DeepSeek Harness 图标变空白。
- Updated dependencies
  - quotern-core@0.1.10

## 0.1.9

### Patch Changes

- 发现新版本后自动下载并尝试重启安装，不再弹窗确认，也不再提供跳过版本；重启失败或超时后恢复本地服务，可在工具栏或设置中一键「更新并重启」。
- 主题切换收敛为单个按钮，在「跟随系统 → 亮色 → 暗色」间循环；支持跟随系统并实时响应外观变化，手动选择的亮/暗主题会持久化。
- 新增 GPT-6 Astra 的官方 Token 定价，并补上缓存读取与缓存写入单价；命中缓存的输入 Token 不再按 0 计费。
- 修复后台同步完成时覆盖较新配置的问题，并避免保存配置时回退最近同步时间。
- 修复把面板时间范围从 7 天扩大到 30 / 90 天后 Token、费用和会话数被重复计算的问题；Desktop 同步进程也会在主进程清空 cursor 后丢弃自己的缓存。
- 修复 macOS 托盘弹窗在后台空同步后仍显示过期「最近同步」时间的问题。
- 修复 macOS 托盘用量弹窗：小时趋势最左侧横坐标被裁切；30 / 90 天范围下每日趋势横坐标被裁切或互相重叠。
- 修复同步和更新提示的关闭按钮被窗口拖拽区域遮挡、无法手动关闭的问题。
- Updated dependencies
  - quotern-core@0.1.9

## 0.1.8

### Patch Changes

- 新增 DeepSeek Harness（dsh）用量采集：读取本地 `~/.dsh` 会话，按消息增量统计 token、模型与项目。
- 修复自动更新：下载时在面板显示进度；安装后未能自动重启时恢复本地服务，并提供「重启并更新」按钮手动重试。
- 定价表补充 Claude Fable 5.1 与 Gemini 3.8 Flash，费用统计按最新价格计算。
- 修复项目分布把工作目录编码路径（如 `%2FUsers%2F...`）直接当标题展示的问题。
- Updated dependencies
  - quotern-core@0.1.8

## 0.1.7

### Patch Changes

- 修复 Desktop、CLI 与 Web 面板每日趋势费用刻度被裁切，较大金额现在可完整显示。
- 降低桌面端后台同步时的主进程卡顿：解析改到独立进程，空轮询不再全量扫描，定价改为启动时拉取一次。
- 新增开机静默启动：开机自启时仅显示托盘、不弹主窗口。
- 托盘驻留时隐藏即销毁主窗口，按需重建，降低内存占用。
- 统一 Desktop 与 Web 的设置弹窗样式。
- 手动同步后弹出成功或失败 Toast。
- Updated dependencies
  - quotern-core@0.1.7

## 0.1.6

### Patch Changes

- 用量页时间范围刷新后仍保留上次选择。
- 筛选栏补充 GitHub 仓库入口。
- 同步 core 的定价表增量更新与模型匹配增强。
- Updated dependencies
  - quotern-core@0.1.6

## 0.1.5

### Patch Changes

- 启动即独占 runtime：停掉 CLI（含自启）并强制抢占 `tud.pid`。
- 心跳 watchdog 监控 runtime；丢失 ownership 或 runtime 掉线时自动 recover。
- `config.json` 损坏可自动恢复；IPC / Dashboard 对 `LOCAL_RUNTIME_NOT_READY` 重试并提示「本地服务正在恢复」。
- Updated dependencies
  - quotern-core@0.1.5

## 0.1.4

### Patch Changes

- Codex / Every Code 将 unknown 模型用量并入同期主导已知模型；聚合费用按 8 位小数累加，避免分桶先四舍五入到分。
- 定价覆盖层落盘缓存，启动复用上次成功拉取的表，刷新后重建聚合缓存。
- 自动更新禁止降级；看板刷新 overlay 不再给卡片染色。
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

- 修复刷新及一批 beta 阶段积累的问题，提升桌面端稳定性。
- 升级内部依赖至 `quotern-core@0.1.1`，整理后发布 `0.1.1` 正式版。

## 0.1.1-beta.13

### Patch Changes

- Updated dependencies
  - quotern-core@0.1.1-beta.9

## 0.1.1-beta.11

### Patch Changes

- fix: allow the macOS updater to close windows and relaunch after installation
- fix: restore the local runtime and close-to-tray behavior if installation fails

## 0.1.1-beta.10

### Minor Changes

- feat: automatically restart and install downloaded updates
- feat: show a one-time success toast after an update completes

## 0.1.1-beta.9

### Minor Changes

- feat: show downloaded auto updates in an actionable toast and check for updates on startup
- chore: upgrade HeroUI to 3.2.4

## 0.1.1-beta.8

### Patch Changes

- test: publish a signed macOS update to verify the in-app auto-update flow

## 0.1.1-beta.7

### Minor Changes

- feat: add signed GitHub Releases auto-update flow for macOS and Windows

## 0.1.1-beta.6

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.8

## 0.1.1-beta.5

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.7

## 0.1.1-beta.4

### Patch Changes

- fix: reefresh
- Updated dependencies
  - quotern-core@0.1.1-beta.6

## 0.1.1-beta.3

### Patch Changes

- Updated dependencies
  - quotern-core@0.1.1-beta.5

## 0.1.1-beta.2

### Patch Changes

- chore: update
- Updated dependencies
  - quotern-core@0.1.1-beta.4

## 0.1.1-beta.1

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.3

## 0.1.1-beta.0

### Patch Changes

- fix: some bugs
- Updated dependencies
  - quotern-core@0.1.1-beta.2
