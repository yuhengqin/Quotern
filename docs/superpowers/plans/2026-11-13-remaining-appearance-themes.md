# 其余外观主题与可选装饰动画

沿用 `codex/appearance-themes`，在共享外观 token / Provider 上扩展，不另建数据界面。保留默认外观、明暗模式、强调色、额度详情、筛选和原生窗口行为。参考 `reference/usage` 的视觉意象，独立编写 CSS / SVG，不复制其模板、脚本或业务逻辑。

## 第一阶段：静态外观

- [x] 补齐 classic、matrix、cloud_observation、aquarium、prism_arcade、stained_glass、migration、sketchbook、heart_monitor、origami、black_hole、lepidoptera、world_cup；每款提供深浅 token 与辨识性材质。
- [x] 17 款风格在同一单选组中分级展开；当前选项收起后仍可见，窄屏与四语言可用。原有四款与默认值保持。
- [x] 扩展对比度/迁移测试与真实 HTTP、Desktop、托盘静态切换验收；查看截图。通过后单独本地提交。

静态证据：`corepack pnpm build`、Desktop typecheck、Dashboard 测试通过；`.quotern-dev/appearance-static-acceptance/results.json` 为真实全量切换验收，查看主题库、主界面和托盘截图。定点核实并修复 Recharts 3.8 新标签分组遗漏主题颜色的问题（深色彩窗原为 2.65:1）；全部新主题实际轴标签已纳入对比度断言。验收倒计时改用合成绝对时间，截图前只显示本脚本自有窗口。

## 第二阶段：装饰动画

- [x] 新增可持久化的装饰动画开关，默认关闭；旧数据无需迁移。浏览器跨标签页及 Desktop 主窗口/托盘共享。
- [x] 逐个加入代码雨、云、水母气泡、棱镜、彩窗光束、鸟群、心电扫线、折纸展开、轨道、蝶翼和足球。classic / sketchbook 与既有三款保持静态。
- [x] 装饰层无交互/读屏语义，不参与数据、尺寸、焦点或点击；限定图形数量与低干扰透明度。CSS 优先变换/透明度，无持续 JS 帧循环。
- [x] 系统减少动态效果、浏览器页面隐藏、Electron 窗口隐藏/最小化均停止并卸载动画；切主题/关闭时清理订阅。托盘裁剪到实际面板，不覆盖透明外沿。
- [x] 扩展契约/持久化测试和真实动画验收（全部主题、开关、跨窗口、隐藏恢复、减少动态效果、关闭与默认恢复）；检查截图。独立审查、适用测试通过后本地提交。

动画阶段定点证据：`.quotern-dev/appearance-motion-delivery/motion-results.json`。11 款 × 深浅模式的真实主界面/托盘动画、暂停失败重试、页面隐藏与原生最小化、初始隐藏、键盘开关、资源阻断后额度详情可用均已验证。320 CSS px 的设置控件全部位于对话框内；原主界面在此模拟宽度下已有 331px scrollWidth，改动后仍为 331px，不能据本次验收声称整个仪表盘已适配 320px。独立代码审查提出的 Electron 事件重载类型问题与测试依赖 OS 减少动态效果问题已修复；10 张装饰截图复核未见明确遮挡或越界。

交付验证：根级 `corepack pnpm test` 通过（`.quotern-dev/appearance-final-test.log`）；末次控件修正后的完整构建、Desktop typecheck、Dashboard 测试分别记录于 `appearance-controls-build.log`、`appearance-controls-typecheck.log`、`appearance-controls-unit.log`。真实联合验收为 `.quotern-dev/appearance-delivery-acceptance/results.json`；随后针对末次修正重新通过完整静态矩阵（`appearance-static-delivery/results.json`）与动画矩阵（`appearance-controls-green/motion-results.json`）。渲染检查发现并修复了翻译插值：项目使用 `{{count}}`；实际安装的 HeroUI 3.2.4 Switch.Content 必须包住 Control / Label，Description 位于同级。滑轨真实点击、键盘切换、四语言主题总数及减少动态效果说明均已回归，已查看末次控件截图。

依据：项目 UI 规范、ui-ux-quality 的控件/布局/验证规则、HeroUI v3 Switch / RadioGroup 文档，以及现代 Web motion 指南。Electron 在禁用 backgroundThrottling 时不可靠地发布页面隐藏状态，必要时使用本窗口 show/hide/minimize/restore 的独立可见性通知，避免更改业务后台任务节流。

验收使用当前 worktree 独立合成数据/用户目录；不接管已运行客户端，不推送或合并 main。Windows 验收不代表 macOS/Linux 原生实测。

## 按用户要求整合至 main

基于本地 main `69812810` 整合主题分支 `c849a537`，在原有主题 worktree 生成候选，保留 main 的通知、热力图及工作流规范更新。preload 冲突同时保留通知导入和外观可见性订阅状态；UI 规范同时保留新外观与通知设置导航。

合并检查补齐通知夹具的外观 IPC、外观夹具的空通知导航，以及两个托盘夹具的当前自启动接口。通知 UI 增加外观初始化断言。外观验收的自有窗口保持后台绘制，避免窗口重叠冻结模态退出动画；隐藏/最小化仍通过真实窗口可见性和浏览器页面隐藏路径独立验证，不改变产品运行策略。

候选的完整 `corepack pnpm test`、Desktop typecheck、完整主题/动画 UI、通知 UI、托盘 UI 分别通过；记录为 `.quotern-dev/appearance-integration-final-test.log`、`appearance-integration-typecheck.log`、`appearance-integration-ui2/results.json`、`appearance-integration-notifications/result.json`、`appearance-integration-island/results.json`。验证在该 worktree 完成，未手动停止、重启或构建 main 的既有开发服务。仅本地合并，不推送；原主题分支及 worktree 保留。
