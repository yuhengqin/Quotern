# quotern-dashboard

按版本记录与当前维护范围相关的变更；现行使用方式和限制见[本包 README](./README.md)。

## 0.1.13

### Patch Changes

- 新增 MiniMax Code、WPS 灵犀（WPS Comate）用量展示；WorkBuddy 改用官方品牌图标。
- 同步 core：OpenCode 2.0、CodeBuddy 整轮用量与缺失日期等修复。
- Updated dependencies
  - quotern-core@0.1.13

## 0.1.12

### Patch Changes

- 概览卡副文案展示请求数与缓存命中率。
- 同步 core：CodeBuddy / Cline / Hermes / ZCode / DSH / Codex 账本与 JSONL 等相关修复。
- Updated dependencies
  - quotern-core@0.1.12

## 0.1.11

### Patch Changes

- AutoClaw 在「工具与模型用量」等统计图标处改用官方品牌图标，此前借用的是 OpenClaw 图标。
- Updated dependencies
  - quotern-core@0.1.11

## 0.1.10

### Patch Changes

- 新增 Command Code、QwenWork（含国内版/国际版）用量展示：同步源、图表与模型列表显示对应图标与品牌色。
- 下载页 Star 旁新增贡献者墙，展示「感谢掘友们的贡献支持」并链到 GitHub contributors。
- 统一卡片汇总、工具筛选和趋势比较口径；趋势改为与紧邻的等长上一周期比较，今天按昨天同期计算。
- 修复 Token 趋势「详细」视图在缓存远大于未缓存输入时把输入画成 0 的问题。
- 修复设置里未勾选复选框在深色模式下几乎不可见；修复白底徽章上 DeepSeek Harness 等内联图标在深色模式变成空白方块。
- Updated dependencies
  - quotern-core@0.1.10

## 0.1.9

### Patch Changes

- 主题切换收敛为单个按钮，在「跟随系统 → 亮色 → 暗色」间循环，图标显示当前模式。支持跟随系统并实时响应外观变化，手动选择的亮/暗主题会持久化（桌面重启后保持，web 刷新后保持）。
- Updated dependencies
  - quotern-core@0.1.9

## 0.1.8

### Patch Changes

- 用量页和下载页增加问题反馈入口，悬停或点击可查看微信二维码。
- 用量页与下载页展示 DeepSeek Harness 来源及官方图标。
- 修复项目分布把工作目录编码路径（如 `%2FUsers%2F...`）直接当标题展示的问题。
- Updated dependencies
  - quotern-core@0.1.8

## 0.1.7

### Patch Changes

- 修复 Desktop、CLI 与 Web 面板每日趋势费用刻度被裁切，较大金额现在可完整显示。
- 下载页改为选取发行版安装包，并展示支持的工具与 GitHub Star 入口。
- 统一 Desktop 与 Web 的设置弹窗样式。
- 手动同步后弹出成功或失败 Toast。
- Updated dependencies
  - quotern-core@0.1.7

## 0.1.5

### Patch Changes

- 个人用量页时间范围刷新后仍保留上次选择。
- 筛选栏补充 GitHub 仓库入口。
- Updated dependencies
  - quotern-core@0.1.6

## 0.1.4

### Patch Changes

- 同步 core 的费用精度与 unknown 模型对齐逻辑。
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

- 修复刷新与一批 beta 阶段暴露的界面问题，提升日常使用稳定性。
- 升级内部依赖至 `quotern-core@0.1.1`，整理后发布首个 `0.1.1` 正式版。

## 0.1.1-beta.9

### Patch Changes

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

## 0.1.1-beta.0

### Patch Changes

- chore: init
