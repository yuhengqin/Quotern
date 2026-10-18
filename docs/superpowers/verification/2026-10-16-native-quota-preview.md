# Desktop 订阅额度 mock 启动验收

基线 `54d58b9`，分支 `codex/quota-management`。

新增 `corepack pnpm dev:desktop:quota`：沿用隔离开发启动器，选择专用 main/preload 入口。窗口复用 `DesktopWindow`，加载当前 worktree 的本机 mock 服务，默认混合场景同时展示 12 个 Agent。

## 验证

- 隔离、打包环境、本机根 URL 与独立 profile 的配置回归先失败后修复；Desktop 类型检查及完整测试通过：316 项，298 通过、18 跳过、0 失败。
- mock main/preload/renderer 构建通过；main 只包含窗口、身份配置与预览 guard，不导入正式主入口、Core runtime、订阅读取、宠物或自动更新。独立只读审查无可行动发现。新增页面预检确保 HTML 路由可用后再打开窗口。
- 修复外部 mock 服务未匹配带查询参数首页的问题。`/?scene=mixed` 现在 HTTP 200，12 种 fixture 检查通过；正常数据未被混合变换修改。
- 实际启动 `corepack pnpm dev:desktop:quota` 成功，Electron 原生窗口标题为 `Quotern Desktop · Mock 预览`。原生可访问性树确认场景选择为「混合场景 · 同时对照」，文档包含 12 Agent 及各自场景，存在最小化、最大化、关闭及各卡片详情入口。
- 独立窗口 profile：`.quotern-dev/electron/quota-preview`。只重启已核实归属的 5173 mock 服务；首次错误预览进程停止后，检查两次进程快照与端口，清理本会话两项已停止租约，再正常启动新实例。

## 限制与产物

原生截图捕获出现 timeout，原生坐标输入因没有截图几何不可用；因此本次原生验收以窗口存在与可访问性内容为证据，没有宣称原生像素截图或详情点击验证。最后窗口保留给用户查看；未为验收关闭它。此前浏览器中的同组件详情、趋势、键盘、窄屏检查仍见各专项报告。

Mock 源码/数据：`C:/Users/Admin/.codex/visualizations/2026/10/16/01a1438e-e643-7760-9601-be32cca26e3e`。日志与隔离构建：`.plans/quota-desktop-preview/`；运行会话记录：`.quotern-dev/desktop.json`。没有使用真实付费接口；18 个跳过测试未执行。
