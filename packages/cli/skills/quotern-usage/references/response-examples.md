# Response examples

These are synthetic excerpts, not complete CLI payloads or the user's records. Read the example matching the question. Preserve the response's purpose, not its exact wording, headings or number of observations.

## Translate metadata for the reader

| Internal fact | Reader-facing wording |
|---|---|
| `sources = ["codex"]` | 仅统计 Codex |
| `snapshot = "persisted"` | 本地已保存数据 |
| `coverage.display.lastSyncAt = "2026-06-07 18:00:00 (Asia/Shanghai)"` | 最近成功同步：6 月 7 日 18:00（北京时间） |
| `cacheHitRate = null` | 讨论命中率时写“暂未记录”；无关时省略 |
| `costUsd = null`, `knownCostUsd = 3.20` | 完整费用未知；已定价部分 $3.20 |

Use readable dates without changing their time zone. Keep provenance, coverage and uncertainty when they affect the answer. A total such as “12.10 亿 Token” belongs in the overview or a metric card; an adjacent interpretation should explain concentration or composition rather than repeat the same total.

## Model ranking

User: 帮我统计最近 7 天各模型的 Token 用量。

Returned facts: June 1–7, 2026, inclusive, `Asia/Shanghai`; no filters; complete coverage for the requested range; persisted snapshot. `summary.tokens = 1210000000`, `summary.cacheReadTokens = 1000000000`, cache hit rate unknown. Rows:

| Source | Model | Tokens |
|---|---|---:|
| codex | model-alpha | 900000000 |
| codex | model-beta | 300000000 |
| claude | model-alpha | 10000000 |

`coverage.display.lastSyncAt = "2026-06-07 18:00:00 (Asia/Shanghai)"`.

Possible answer:

> 6 月 1–7 日（Asia/Shanghai），共记录 **12.10 亿 Token**。用量最高的两项合计占 **99.2%**。
>
> 下表按用量排序，M 表示百万 Token：
>
> | 模型 | 来源 | Token（M） | 占比 |
> |---|---|---:|---:|
> | model-alpha | Codex | 900.00 | 74.38% |
> | model-beta | Codex | 300.00 | 24.79% |
> | model-alpha | Claude | 10.00 | 0.83% |
>
> 其中 **10 亿是缓存读取 Token，占总量约 82.6%**，因此总量不能全部理解为新输入或新生成的文本量。
>
> 以上来自本地已保存快照。最近成功同步：6 月 7 日 18:00（北京时间）；各来源可能仍有更新延迟。

What this demonstrates: readable units, shares calculated before rounding, complete rows, separate identities for the same model on different Agents, concentration and composition explained without inferring productivity or a cache hit rate.

## Single estimated cost

User: 今天 Codex 大概用了多少钱？

Returned facts: June 7, 2026, `Asia/Shanghai`; filter `sources = ["codex"]`; complete coverage for the day; persisted snapshot. `costUsd = knownCostUsd = 12.3456`; `reportedCostUsd = 0`; `estimatedCostUsd = 12.3456`; no unpriced or default-priced tokens. `coverage.display.lastSyncAt = "2026-06-07 18:00:00 (Asia/Shanghai)"`.

Possible answer:

> 今天（6 月 7 日，北京时间）Codex 的**估算费用约为 $12.35**，按适用费率计算，不代表实际支付金额。统计来自本地已保存快照；最近成功同步：18:00，各来源可能仍有更新延迟。

What this demonstrates: answer one question in one short paragraph, identify estimated pricing and snapshot scope, and skip an unnecessary table, token breakdown or spending recommendation.

## Incomplete collection and pricing

User: 最近 7 天一共用了多少 Token，花了多少钱？

Returned facts: requested June 1–7, 2026, `Asia/Shanghai`; `coverage.limited = true`; collection starts June 4 at 10:00 local time, so June 1–3 and part of June 4 are outside coverage. Persisted snapshot. `summary.tokens = 4000000`; `costUsd = null`; `knownCostUsd = 3.20`; priced portion is rate-estimated; `unpricedTokens = 1000000`. `coverage.display.collectSince = "2026-06-04 10:00:00 (Asia/Shanghai)"`, `coverage.display.lastSyncAt = "2026-06-07 18:00:00 (Asia/Shanghai)"`.

Possible answer:

> 请求范围是 6 月 1–7 日（北京时间），但本地从 **6 月 4 日 10:00** 才开始采集。目前记录了 **400 万 Token**，不能代表完整 7 天的用量。
>
> 已定价部分的估算费用为 **$3.20**，另有 **100 万 Token 缺少价格**，因此暂时无法给出完整费用；缺价部分不等于免费。
>
> 以上来自本地已保存快照。最近成功同步：6 月 7 日 18:00（北京时间）；各来源可能仍有更新延迟。

What this demonstrates: qualify the headline with the actual collection boundary, retain unknown total cost, distinguish priced subtotal from a complete bill, and avoid extrapolating missing days or silently running a sync.
