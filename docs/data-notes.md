# 数据采集与统计注意事项

采集结果必须在重复执行、扩大日期范围、日志写入中途和应用重启后保持一致。下列规则以 Core 的实际合并和读取方式为依据；扩展 parser 时应保留对应的回归用例。

## 统计桶与增量状态

[bucketKey](../packages/core/src/queue/keys.ts) 由 `source | collector | model | project | hour_start` 组成。`hour_start` 的名字虽含 hour，实际按 UTC 半小时对齐。队列按 UTC 月写入 JSONL，同 key 可以有多个版本；[读取队列](../packages/core/src/queue/index.ts)时以后出现的版本为准，不能把文件中的所有行直接求和。

通用合并路径 [syncSourceBuckets](../packages/core/src/sync/index.ts) 用 `parsedFullRescan` 区分 parser 返回的两种桶语义：

- 解析前无有效游标、解析后出现状态：结果是重扫快照，替换同 key 旧桶。
- 有增量状态的续读：结果是差额，与旧桶累加。

通用路径不会仅因旧 key 未再次出现就清除它；`unknown` 模型归并仍可能撤销旧桶。专用来源另有规则：

- Cursor 每轮返回快照。非空快照直接替换同 key 桶，并在本轮涉及月份、不早于快照最早时间的范围内清零已消失的旧 Cursor key。
- AutoClaw / WorkBuddy 还识别 parser 的 `fullRescan` 迁移标记，分别撤销迁移后不再产出的旧项目桶或旧 `unknown` 项目桶。
- 上述路径收到空桶结果时提前返回，不据此清空已有统计。

扩大采集窗时清游标并通知 Desktop worker 丢弃自己的游标缓存，保留 queue 后补扫；缩小展示范围不收缩采集下限。桶写盘后立即保存游标可以缩短重复读取窗口，但两个文件的写入不是一个数据库事务，不应宣称具备任意崩溃下的严格一次性保证。

例：已有一条 120 Token 的记录，范围从 7 天扩大到 90 天后再次读到它，结果仍应是 120；以后新读到 30 才累加为 150。

证据：[范围扩展测试](../packages/core/test/range-expand.test.ts)、[项目迁移测试](../packages/core/test/workbuddy-autoclaw-migration.test.ts)、[ensureLocalCollectRange](../packages/core/src/server/state.ts)。

## JSONL 尾部与文件变化

使用 [JsonlLineReader](../packages/core/src/parsers/jsonl-tail.ts) 返回的 `nextOffset` 保存字节偏移，不能用开始扫描时的文件大小代替实际消费位置。

- 带换行的完整记录可以推进游标；损坏的已换行记录会被越过，避免永久卡住。
- 无换行尾部只有在可判为完整 JSON 时才提交；半条记录留待下轮重读。
- 多字节字符、CRLF、文件追加与截断需要独立处理，字符数不能充当字节偏移。
- 文件替换或缩短时按各 parser 的 inode / size 检测规则重新读取，并保持快照与差额语义一致。

证据：[JSONL 边界测试](../packages/core/test/jsonl-tail.test.ts)。

## 累计账本与多来源去重

Codex JSONL 提供拆分明细，线程数据库提供生命周期累计量。[codex-ledger.ts](../packages/core/src/parsers/codex-ledger.ts) 只补尚未被文件或已记水位解释的差额，不能把数据库累计值直接加到文件结果上。

水位表示已经贡献的生命周期总量，会随本轮精确明细和已观察文件累计量推进。窗口外记录和 fork replay 也会影响已观察量，避免它们重新成为补差。已有 rollout 游标但没有账本水位时先初始化，不再次计入整段历史。

例如账本累计 100、已解释文件累计 60，仅补 40。账本缺少输入、输出和缓存拆分，补差当前归入 `input_tokens`，并标记 `collector=codex-ledger`；这部分费用是估算，不能解释为完整请求明细。

证据：[账本补差测试](../packages/core/test/codex-ledger.test.ts)。

数据源目录支持范围要逐个确认。当前 [WorkBuddy parser](../packages/core/src/parsers/workbuddy.ts) 读取单个 `WORKBUDDY_HOME`（默认 `~/.workbuddy`）及其 `workbuddy.db`，没有同时合并两个安装目录的逻辑。其他工具的多目录支持不能直接类推到 WorkBuddy。

## Token 总量与展示拆分

[computeTokens](../packages/core/src/pricing/index.ts) 按下面五项相加，缺失字段按 0 处理：

```text
input_tokens + output_tokens + cached_input_tokens
  + cache_creation_input_tokens + reasoning_output_tokens
```

该函数直接计算明细，不信任存量 `total_tokens`。来源归一化仍由 parser 负责，例如 ZCode 输入包含缓存时先拆出缓存，其供应商总量不含 reasoning 时要补齐。不要在 UI 再做一轮相同扣减。

趋势图使用 API 提供的权威总量，拆分未覆盖的部分保留为 `otherTokens`。小时 API 的输入是未缓存输入：输入 10、缓存读 12,000、输出 8 时，图表仍应显示输入 10，总量 12,018。

主面板和托盘复用 [dashboard-trend.ts](../packages/core/src/dashboard-trend.ts) 的投影；修改日期范围、来源筛选或趋势比较时，还要核对两份 `usage-filter.ts` 和 `dashboard-data.ts`。

证据：[趋势测试](../packages/core/test/dashboard-trend.test.ts)、[Dashboard 数据测试](../packages/dashboard/src/lib/dashboard-data.test.ts)、[来源筛选测试](../packages/dashboard/src/lib/usage-filter.test.ts)。

## 请求数与缓存命中率

[local-metrics.ts](../packages/core/src/local-metrics.ts) 区分完整请求计数与已知下界：有完整证据时使用 `requestCount`；证据不足时 `requestCount` 可以为 `null`，`knownRequestCount` 使用已有证据或合法的 `conversation_count`。

缓存命中率为：

```text
缓存读 /（未缓存输入 + 缓存读 + 缓存写）
```

先汇总原始数量，再计算比例。缓存字段未知或分母为零时返回 `null`；未知不能显示成已确认的零命中。合并时保留 `missingReasons`，不要用均值代替总量计算。证据：[本地指标测试](../packages/core/test/local-metrics.test.ts)。

## 费用与价格匹配

价格单位是美元 / 百万 Token。费用算法与统计总量算法分别维护：Codex 和 Every Code 的 reasoning 费用已包含在 output 中，不能再收一次；Cursor 在有正的有效账单金额时优先使用来源金额。其他来源及无价格模型的兜底以 [computeRowCost](../packages/core/src/pricing/index.ts) 为准。

来源金额字段不一定直接用于面板费用：例如 KinetAios 保存 `reported_cost_usd`，当前费用函数仍按模型价格计算该来源。QwenWork 根据消息内容估算 Token，也不能当作供应商账单的精确读数。

[价格匹配](../packages/core/src/pricing/matcher.ts)在单层表内按精确名称及其规范化形式、来源别名、全局别名、推理后缀剥离、供应商前缀派生、模糊匹配等顺序查找。覆盖表先于内置表查询；不要把单层的精确优先误写成跨两层全局精确优先。供应商键有多个候选时，优先路径层级少的键，再按字典序稳定选择。

`auto`、`composer` 等名称要按来源解释，不能仅凭宽泛子串猜成另一供应商的模型。更新价格时保留人工条目并核对覆盖表行为，详见 [pricing.test.ts](../packages/core/test/pricing.test.ts)。

价格覆盖表在启动时先读磁盘缓存，再请求一次 Quotern 仓库中的 `packages/core/src/pricing/pricing.json`；失败保留可用缓存或内置表。浏览器价格页使用同一地址，网络不可用、仓库无法公开读取或响应无效时展示内置价格表。`ttlMs` 配置存在不代表定时轮询已经启用。覆盖表变化后需要重建聚合费用，展示值是当前计价结果，不是冻结的历史发票。

## 日历、封存与配置写入

队列时间使用 UTC，面板日期分组使用 [timezone.ts](../packages/core/src/timezone.ts) 的本地日历规则。今天实时计算，过去日期读取封存缓存。启动时补齐有记录但未封存的日期；跨午夜或休眠多日后，即使同步没有写出新桶，也要触发日历封存检查。历史桶变化时重封受影响日期。

证据：[AggregateCache](../packages/core/src/aggregate-cache.ts)、[缓存测试](../packages/core/test/aggregate-cache.test.ts)、[createApplyAfterSync](../packages/core/src/server/state.ts)。

配置初始化、保存和运行时完成时间都经过 [config.ts](../packages/core/src/config.ts) 的跨进程锁。后台任务完成时先读最新配置，只更新自己的 `lastSyncAt`；设置保存也保留较新的运行时时间。临时文件与 rename 负责完整写入，Windows 的占用错误有重试，不能直接对 `config.json` 并发覆盖写入。

证据：[配置并发测试](../packages/core/test/config-concurrency.test.ts)。其中并发读取压力用例在 Windows 跳过，不能把其他平台的通过结果当作该分支的实机验证。
