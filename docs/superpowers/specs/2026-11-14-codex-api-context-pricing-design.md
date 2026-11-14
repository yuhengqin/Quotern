# Codex API 长上下文估价

用户已在本会话确认按官方 API 等价费用补齐计价（“OK，就这么改”）。金额继续表示当前模型参考价下的 API 成本估算，订阅标记不免除该估算中的 API 修饰规则；实际支付仍由现有账单说明解释。

## 范围与取舍

- 沿用 Core 的请求事实及规则入口，让报表、汇总和会话使用同一计算结果。
- 保持当前仅按基础价估算会低估长请求；按整段会话加倍会误算短请求。采用已同意的逐请求计价。
- 仅为 Codex 中已核实的官方定价 ID `openai/gpt-6-astra`、`openai/gpt-6.1-sol`、`openai/gpt-6-luna` 补齐长上下文规则。第三方渠道、其他来源、未知请求长度及无请求事实的旧桶保持既有估价。
- 完整请求输入（未缓存输入 + 缓存读 + 缓存写）严格超过 272,000 时，整个请求输入/缓存读写乘 2，输出（含推理且只计一次）乘 1.5。Standard/Fast/Flex 的长上下文组合必须正确计算。
- 不修改外部 `request_rules` 结构或既有按档位、阈值排序的优先级。用户基础单价仍参与倍率计算；同档位同阈值的显式规则仍可覆盖。
- 新长上下文规则按当前 API 参考价重估保存了完整证据的请求，不添加虚构的历史生效日期。现有 Fast/Flex 的 2026-10-18 UTC 下界保留。文档核实日期为 2026-11-14，不代表供应商调价日期。
- 将内置请求计价修订号纳入价格指纹，使旧磁盘封存缓存自动重建；保留数值事实，无需重采日志。
- 保留来源报告费用、缺价与明确零价、Legacy remainder、Token 数量和任务时长。此次不增加 UI 或改变响应结构。

## 验收

覆盖三个型号与三个档位、272K 边界和缓存输入、多个短请求、证据缺失、零/缺单价、用户单价与规则、订阅会话重计价及旧指纹缓存升级。使用冻结的截图数值请求（212 次）复算预估金额 $13.0370366。执行 Core 全部测试及生产类型检查；对依赖 Core 的 Desktop 执行适用检查。仅在独立临时状态中验证，不重启其他会话服务。

## 官方依据

- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing

当前页面明确 >272K 的整请求倍率，价格表列出 Standard/Fast/Flex 短长组合。API 输入包含缓存，Quotern 的分项事实在保存 `requestInputTokens` 时已合回完整输入。
