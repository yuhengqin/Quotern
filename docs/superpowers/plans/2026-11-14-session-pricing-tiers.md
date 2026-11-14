# Session Pricing Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 以四项汇总和按需分档详情解释会话费用，保留实际计价条件。

**Architecture:** Core 逐费率字段输出条件；共享投影保留其身份后合并同类项目；共享 UI 使用 HeroUI Popover 展示分档。

**Tech Stack:** TypeScript、React19、HeroUI3、Electron35、Node test、pnpm11.1.2。

**Spec:** [设计](../specs/2026-11-14-session-pricing-tiers-design.md)

## Global Constraints

- main 起始完全干净（bfdf0d92），按仓库规则直接修改并本地原子提交。
- 价格、数量与费用统一格式化，四语言与双端共享。
- 不以单价推断 Fast/Flex 或上下文阈值；缺条件保持未知。
- 不改变已有费用、Token、来源金额与交互功能；只操作测试所属服务与临时状态。

## Review Focus

- 同价不同条件被合并，或部分字段自定义规则导致错误标签。
- 缺失的请求总输入被标成 ≤272K，或未生效的历史 Fast 被显示为生效档位。
- 汇总重复计费、舍入后相加，或未知值变成零。
- Popover 的 Escape 关闭主 Modal、焦点丢失或窄屏裁切。
- Desktop 共享样式、翻译与旧 runtime 回退遗漏。

### Task 1: 条件证据与共享显示

**Files:** Core request-pricing/session-observation 及其测试；Dashboard session-detail、SessionUsageBreakdown、usage-messages 及其测试；Desktop session-detail smoke；UI/数据说明与 changeset。

**Interfaces:** TokenCostItem/SessionModelCostItem 增加可选 conditions；DetailModel 增加纯展示 pricingGroups，不修改统计数量与金额。

- [x] 写 Core 分项条件、同价不同条件回归及 Dashboard 组内/跨会话聚合回归，并观察失败。
- [x] 按每个最终费率字段输出实际条件，更新合并键。
- [x] 实现四项汇总与单价 Popover、四语言及旧 runtime 条件未知回退。
- [x] 更新现有 smoke 的重复行断言，补 HTTP/IPC 分档、焦点、窄屏、单位及语言检查。
- [x] 执行相关测试、完整 Core/Dashboard 测试、双端构建和 session-detail UI smoke；查看实际截图。
- [x] 独立审查、修复必要问题、同步文档与 changeset，确认工作区归属并本地提交。

## 验证记录

- 先观察 Core 的3项条件回归、Dashboard的2项投影回归失败，再补齐条件及分组后转绿。另用带零量默认缓存写价的 TTL 夹具复现无消费档位噪音，展示过滤转绿，汇总仍使用全部原始分项。
- Core完整测试910项：908通过、2项既有平台跳过；脚本测试16项通过。Dashboard完整328项通过，四语言目录/插值一致性1项通过。
- 根 `corepack pnpm build`、最终Dashboard/Desktop构建、Desktop类型检查通过。最终 `corepack pnpm --filter quotern build` 更新CLI内置Dashboard副本。
- 界面回归首先发现旧夹具仅发布大肥鱼导航事件，与当前通知桥接不符，已补通知通道别名；随后实际Escape验收暴露分档浮层关闭后焦点移位，修复为只关闭当前层并恢复原单价按钮，复验通过。
- 最终 `corepack pnpm test:session-detail-ui D:/AgentPro/Quotern/.quotern-dev/session-pricing-tiers-ui-20261114-verified` 通过。HTTP和真实preload/IPC窗口使用同一fixture，覆盖四项合并、同为$4的不同条件、实际Fast/Flex/长上下文、旧runtime缺条件、TTL和小计、Enter/Space/鼠标、Escape焦点、外点、祖先滚动关闭、短窗口内部滚轮保持打开、320px、四语言及浮层打开时切换Token单位。
- 已查看宽屏汇总、中文本地化分档和窄屏浮层截图；数据表和浮层都保持在各自滚动/视口范围。测试使用独立合成API、临时profile和随机端口，未重启既有服务。
- 冻结212次请求的费用仍为13.0370366。实际Electron分析utilityProcess18次查询，冷301ms、热3–13ms，20ms主进程心跳最大额外延迟73ms，renderer心跳616次。该证据针对冻结样本，不声称覆盖全部历史规模或安装包。
- 独立只读审查覆盖全部13个变更文件，未发现Critical/Important/Minor问题；建议追加的Space、祖先及内部滚动路径已在最终UI回归补测。计价修订号维持原值，因为本次仅增加读取时产生的条件证据，不改变计费结果。
