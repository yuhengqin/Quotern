# 订阅额度细节调整验收

开发分支 `codex/quota-management`，基线 `7012488`；main 未修改。Mock 位于 `C:/Users/Admin/.codex/visualizations/2026/10/16/01a1438e-e643-7760-9601-be32cca26e3e`，继续使用 <http://127.0.0.1:5173/>。

## 行为

- 卡片与详情的时间限额按月、周、日、小时排序；不修改来源窗口和分析数据。未知周期与独立模型原有顺序保留。卡片仍显示前三项，详情显示全部。
- Cursor 使用「Cursor模型额度」「其他模型额度」；Copilot Code completions 使用「代码补全」。
- 百分比窗口的 0% 已表达耗尽，删除自动生成的通用「额度已用尽」段落。登录失效、来源错误及组织共享池耗尽仍保留。
- Copilot 仅在真实快照明确两项无限时合并「聊天与代码补全 · 无限」。现代 Credits 快照保留明确无限的补全，不将缺失/有限的 Chat 推断成无限。Free 有限额不合并。当前套餐依据：[官方个人计费说明](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing)。
- 同一已知账号/功能范围只展示最早一条可靠耗尽预测；跨相关重置、已耗尽池或未知短周期重置的估算不展示。长周期确实可能先耗尽，故未采用只显示最短周期的固定规则。独立模型分别判断；历史、通知、主进程分析不变。
- 异常卡片状态行至少 32px，同排网格拉齐；mock 默认宽度与 390px 窄屏下 12 张异常卡片均为 86px 高，无横向溢出。

## 检查

- 新增排序、预测分组/边界、双无限合并与 Copilot 显式权益回归；先失败后修复。独立审查发现 Grok `billing/周期` 的账号分组遗漏，已补真实 mapper 形状测试；已知/未知 session 重置及耗尽均覆盖。
- Desktop 类型检查通过。
- Desktop 完整测试 311 项：293 通过、18 跳过、0 失败。
- Electron main/preload/renderer 生产 bundle 构建通过，输出在 `.plans/quota-details-refinement/build-final`，未覆盖正在运行的开发 `out`。保留已有 dashboard device-filter 动态/静态导入警告及隔离 outDir 提示。
- 浏览器检查：12 卡片；Kimi 详情四窗口顺序与一条预测；OpenCode 月/周/5 小时；Cursor 中文名、统一/分别重置；Copilot 三种权益及详情合并；耗尽状态无冗余段落；重试不打开详情；方向键查看趋势及 Escape 关闭；深色、390×844 无溢出。控制台无错误。
- Mock 真实 mapper/normalizer/分析函数校验通过；17 种趋势形状、25 条趋势。截图与结构化记录见 mock 目录。

日志在 `.plans/quota-details-refinement/`。未使用真实付费账号调用上游，未验证系统通知实际送达、原生托盘点击或安装包；18 个跳过测试未运行。仅重启已核实归属的 mock 服务，保留其他开发服务。
