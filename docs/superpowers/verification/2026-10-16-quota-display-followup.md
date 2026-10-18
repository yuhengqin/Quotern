# 订阅限额显示与 Mock 跟进验证

基线：`codex/quota-management`，`1c175ce`。沿用现有独立 worktree；未合并或修改主工作区。

## 变更与验收

- 主文案使用「使用较慢 / 使用偏快 / 节奏正常」，悬停解释当前已用比例、参考比例与实际依据；百分点差值保留为内部计算口径。
- 两个及以上窗口的精确重置时间全部相同，且不存在到期窗口时，卡片与详情各显示一次「统一重置」。未知、相差一秒、单窗口和到期时间不合并。
- 详情趋势增高至 36px，保留固定 0–100% 纵轴、鼠标读数与方向键选择。
- OpenCode 支持五小时、周、月：兼容 `usage.*.percent/resetsAt` 与早期 `*Usage.usagePercent/resetInSec`，官方 `percent: 1` 保持 1%；相对重置零秒有效；未知月周期长度不补成 30 天。
- Antigravity 保留全部有效模型池，卡片前三条、详情全部；同名不同 ID 保留，耗尽模型能够影响托盘风险。
- Mock 使用真实 mapper、normalizer 与分析函数，包含持续、突增、停用、间歇及近期使用；历史不早于已知周期起点。

## 自动化

在 worktree 根执行：

```text
corepack pnpm --filter quotern-desktop typecheck
corepack pnpm --filter quotern-desktop test
corepack pnpm --filter quotern-desktop exec electron-vite build --outDir "C:/Users/Admin/.codex/worktrees/quota-management/Quotern/.plans/quota-display-followup/build"
git diff --check
```

全部退出码为 0；Desktop 304 tests，286 pass，18 skipped，0 fail。主进程、preload、renderer 生产 bundle 构建完成，输出隔离在 `.plans/quota-display-followup/build`，未覆盖开发服务的 `out`。构建有输出目录不自动清空及既有动态/静态 import 混用提示。

先验证新增的共同重置与第三个 Antigravity 池测试失败，再实现并验证通过；OpenCode 三窗口、新旧官方结构与命名月池测试同样经过失败到通过。跨层测试覆盖 mapper → normalization → 托盘风险。

只读独立代码审查未发现指定范围内可行动问题。类型检查和完整 Desktop 测试日志位于 `.plans/quota-display-followup/desktop-{typecheck,test}.log`。

## 浏览器与预览产物

目录：`C:/Users/Admin/.codex/visualizations/2026/10/16/01a1438e-e643-7760-9601-be32cca26e3e`；地址 `http://127.0.0.1:5173/`。仅替换已核实归属的旧 mock 服务，保留其他开发服务。

- 12 张卡；OpenCode 卡片与详情均有三种限额。
- Kimi 四个详情趋势高 36px，曲线形状不同；左方向键显示「剩余 65%」，节奏解释为当前已用 38%、参考 50%。
- Cursor 详情仅一处重置文案，完整日期 title 保留；不同重置场景下 Antigravity 逐项显示三处时间，不显示统一重置。
- 390×844 页面与弹窗均无横向溢出，OpenCode 三个进度条完整显示。
- 无历史状态无趋势；告警/耗尽状态仍显示已用尽，不再显示冗余接近上限文字；过期、自定义供应商与失败重试状态可见。
- 深色详情、Esc 关闭正常；浏览器未报告错误。验收后恢复浅色、正常状态、共同重置与默认 viewport。
- `node verify-mock-data.mjs` 通过：25 条趋势、17 种不同的增量形状；检查百分比边界、单调时间、最终读数和当前周期边界。

上述目录包含更新后的 mock 服务/数据/界面、README、两份 JSON 验证结果及 `all-agent-cards.png`、`kimi-details.png`、`opencode-details-mobile.png` 实际截图；已逐图检查。

## 限制

未使用真实 OpenCode Go 付费账号或 Antigravity 云账号执行现网端到端验证；协议依据为官方 [v1.19.0 usage 路由](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/console/app/src/routes/zen/go/v1/usage.ts)及[早期结构](https://github.com/anomalyco/opencode/blob/2b8a596/packages/console/app/src/routes/zen/go/v1/usage.ts)。18 个跳过用例、系统通知送达、原生托盘点击与安装包发布不在本轮验证范围。
