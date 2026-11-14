# Codex API Context Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Codex 的 API 长上下文估价，并让存量数值缓存随规则修订重算。

**Architecture:** 在现有请求级规则中生成长上下文及 Fast/Flex 组合费率，保留外部规则结构与排序。价格指纹加入内置规则修订号，复用缓存原有失效和回退机制。

**Tech Stack:** TypeScript、Node.js node:test、pnpm 11.1.2。

**Spec:** [设计](../specs/2026-11-14-codex-api-context-pricing-design.md)

## Global Constraints

- main 完全干净且无已确认其他写任务，按仓库规则在 main 串行实施并创建本地原子提交。
- 仅 Codex 的三个已核实官方定价 ID；当前 API 参考价重估，不声称恢复历史账单。
- 原有 Fast/Flex 的 2026-10-18 UTC 下界保留；新长上下文规则不虚构历史起始日期。
- 保留外部规则排序、手动基础单价、来源金额、缺价/零价、旧桶回退和原有展示。
- 不管理既有服务；测试仅产生本任务临时状态。源代码由主代理修改，调查与最终审查只读。

## Review Focus

- Fast/Flex 规则覆盖标准长上下文费率，导致长上下文倍率丢失。
- 缓存输入漏入阈值，或以桶/会话累计输入误触发阈值。
- 新规则令零价格变成未知，或让未知单价变成免费。
- 升级仍接纳旧价格指纹的封存缓存，历史总费用与会话费用不一致。
- 自定义费率/显式规则或来源报告金额被默认修饰规则意外覆盖。

### Task 1: 统一请求估价与缓存升级

**Files:**
- Modify: `packages/core/src/pricing/request-pricing.ts`
- Modify: `packages/core/src/pricing/index.ts`
- Create: `packages/core/test/codex-long-context-pricing.test.ts`
- Modify: `packages/core/test/session-codex-compaction.test.ts`（已有长压缩请求的金额预期）
- Modify: `docs/data-notes.md`
- Create: `.changeset/<unique>.md`

**Interfaces:** 保留 `builtinRequestRules(model, source, base)` / `priceRequest(fact, base, rules)`；`getPricingFingerprint()` 同时识别计价实现修订。

- [x] 为三个型号 Standard/Fast/Flex 写长请求回归。Sol 样本为未缓存输入10,000、缓存读280,000、缓存写1,000、输出6,000、推理4,000；预期费用分别 0.251 / 0.502 / 0.1255。
- [x] 补齐严格阈值、完整输入缺失、短请求合桶、手动价格与显式覆盖、缺价/零价、订阅重计价及旧指纹封存升级测试。
- [x] 执行 `corepack pnpm --filter quotern-core test:compile` 与新测试，确认目标行为失败。
- [x] 实现长上下文组合规则和指纹修订号；不改解析、会话结构或 UI。
- [x] 运行定价/缓存/会话定价相关测试，核对新回归转绿。更新数据说明与 Core patch changeset。
- [x] 在隔离数值样本上核对截图212次请求：Token 43,009,856、费用13.0370366；不使用变化中的整段会话总额比较。
- [x] 运行 Core 完整测试、生产类型检查及适用的 Desktop 类型/分析服务检查，检查完整输出。
- [x] 请求一次独立只读审查；解决真实问题后执行必要回归，确认仅含本任务变更并本地提交。

## 验证记录

- 新增19项回归先出现16项预期失败，补齐规则后全部通过；关联定价、缓存和会话检查118项通过。
- 首次完整 Core 验证发现原压缩请求测试仍使用短上下文金额。该请求输入453,785，应按长上下文计价：`(153 × 4 + 453632 × 0.2 + 6348 × 15) / 1e6 = 0.1865584`。已更新这项金额预期，保留全部去重与数值断言。
- 最终 `corepack pnpm --filter quotern-core test`：907项中905通过、2项既有平台跳过；Core脚本16项通过。
- Core生产 `tsc --noEmit` 与 Desktop `typecheck` 通过。
- 冻结CodeBurn数值缓存中截图对应的212次请求（输入844,109、输出含推理96,499、缓存42,069,248）后，在独立数据目录生成无正文的数值来源，按Quotern现有会话采集和API路径重放。计算、会话与报表均为13.0370366；Sol193次中71次进入长上下文，Astra19次没有长请求。
- 实际Electron35.4 utilityProcess使用同一冻结数据进行17次查询，冷查询319ms、热查询3–9ms，主进程20ms心跳最大额外延迟63ms，renderer心跳617次。仅验证隔离原生进程查询和心跳；本次未操作用户窗口或重启既有服务，不声称完成菜单、滚动等人工交互验收。
- 独立只读审查未发现Critical/Important/Minor问题。确认保留原档位日期下界、显式规则既有排序与现有模型匹配范围；未扩大审计其他模型和渠道。
- 本次未核实供应商历史长上下文价格生效日期，采用当前API参考估价；不把核实日期或模型发布日期解释为历史调价日。
