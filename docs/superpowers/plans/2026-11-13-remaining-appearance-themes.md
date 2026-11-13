# 其余外观主题与可选装饰动画

沿用 `codex/appearance-themes`，在共享外观 token / Provider 上扩展，不另建数据界面。保留默认外观、明暗模式、强调色、额度详情、筛选和原生窗口行为。参考 `reference/usage` 的视觉意象，独立编写 CSS / SVG，不复制其模板、脚本或业务逻辑。

## 第一阶段：静态外观

- [x] 补齐 classic、matrix、cloud_observation、aquarium、prism_arcade、stained_glass、migration、sketchbook、heart_monitor、origami、black_hole、lepidoptera、world_cup；每款提供深浅 token 与辨识性材质。
- [x] 17 款风格在同一单选组中分级展开；当前选项收起后仍可见，窄屏与四语言可用。原有四款与默认值保持。
- [x] 扩展对比度/迁移测试与真实 HTTP、Desktop、托盘静态切换验收；查看截图。通过后单独本地提交。

静态证据：`corepack pnpm build`、Desktop typecheck、Dashboard 测试通过；`.quotern-dev/appearance-static-acceptance/results.json` 为真实全量切换验收，查看主题库、主界面和托盘截图。定点核实并修复 Recharts 3.8 新标签分组遗漏主题颜色的问题（深色彩窗原为 2.65:1）；全部新主题实际轴标签已纳入对比度断言。验收倒计时改用合成绝对时间，截图前只显示本脚本自有窗口。

## 第二阶段：装饰动画

- [ ] 新增可持久化的装饰动画开关，默认关闭；旧数据无需迁移。浏览器跨标签页及 Desktop 主窗口/托盘共享。
- [ ] 逐个加入代码雨、云、鱼泡、棱镜、彩窗光束、鸟群、心电扫线、纸飞机、轨道、蝶翼和足球。classic / sketchbook 与既有三款保持静态。
- [ ] 装饰层无交互/读屏语义，不参与数据、尺寸、焦点或点击；限定图形数量与低干扰透明度。CSS 优先变换/透明度，无持续 JS 帧循环。
- [ ] 系统减少动态效果、浏览器页面隐藏、Electron 窗口隐藏/最小化均停止并卸载动画；切主题/关闭时清理订阅。托盘裁剪到实际面板，不覆盖透明外沿。
- [ ] 扩展契约/持久化测试和真实动画验收（全部主题、开关、跨窗口、隐藏恢复、减少动态效果、关闭与默认恢复）；检查截图。独立审查、适用测试通过后本地提交。

依据：项目 UI 规范、ui-ux-quality 的控件/布局/验证规则、HeroUI v3 Switch / RadioGroup 文档，以及现代 Web motion 指南。Electron 在禁用 backgroundThrottling 时不可靠地发布页面隐藏状态，必要时使用本窗口 show/hide/minimize/restore 的独立可见性通知，避免更改业务后台任务节流。

验收使用当前 worktree 独立合成数据/用户目录；不接管已运行客户端，不推送或合并 main。Windows 验收不代表 macOS/Linux 原生实测。
