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

Codex 计量读取 `sessions` 和 `archived_sessions` 中的 `.jsonl` / `.jsonl.zst`。同目录双副本优先普通文件，共用逻辑路径；游标偏移始终指向解压后的字节。格式切换或归档移动依赖事件身份去重，损坏压缩文件报错且不提交半轮游标。消息/会话元数据采集仍沿用独立的普通 JSONL 入口，本次没有扩大其压缩归档覆盖范围。

独立 compaction 通过 `token_usage_record.response_id` 和 `compacted.compaction_response_id` 配对；仅匹配标记的用量进入统计，状态跨扫描保存。最新请求已被推进的 `token_count` 覆盖时不另加一次；独立用量不改变普通累计差分的基线。首次升级会重放旧文件前缀补识别 compaction，已记录普通事件不重复输出。

compaction 与账本采取保守重叠口径：账本先补出差额时，可将该额度分配给同线程待配对请求；标记晚到只输出剩余量，部分剩余仍标为账本补齐，不能恢复精确输入/输出/请求数。旧游标升级也用已记账本水位超过普通用量的部分抵扣。账本没有 response ID，无法证明差额属于哪个请求；在请求记录出现之前已经补出的差额，以及旧数据无法恢复的关联，是这一口径的限制。账本实际读数与“普通用量 + 独立 compaction + 补差”的水位分别保存，避免把账本暂时落后误判为重置。

数据源目录支持范围要逐个确认。当前 [WorkBuddy parser](../packages/core/src/parsers/workbuddy.ts) 读取单个 `WORKBUDDY_HOME`（默认 `~/.workbuddy`）及其 `workbuddy.db`，没有同时合并两个安装目录的逻辑。其他 Agent 的多目录支持不能直接类推到 WorkBuddy。

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

会话概览通过独立的 `sessions/<source>.json` 本地元数据缓存采集，不从 Token 桶的 `conversation_count` 推导。保存会话/消息身份、角色、时间和不可逆的回放匹配摘要，不保存消息正文。Schema 5 额外为 Claude/Codex 的明确 cwd 保存项目路径哈希和末级目录名，不保存完整路径；自动重读仍存在的旧日志补齐证据。独立游标首次补扫原始消息，后续 JSONL 追加增量读取；文件重写重建对应快照。消息单独变化也触发面板刷新。

会话数按来源和逻辑会话去重，总消息数只计用户与 AI 逻辑消息，排除工具、元数据及事件镜像。日期筛选只使用范围内的消息：跨天会话计一次，总时长是各会话范围内首末消息跨度之和；同时进行的会话分别累计。不具备完整消息元数据的来源显示覆盖不完整。

Schema 8 增加独立用量事件与上下文观察，首批支持 Claude、Codex、OpenCode、Pi、OMP，不改变既有消息计数或 Token 桶。Claude 按调用覆盖流式快照；Codex 与既有 parser 保持相同的 per-call / 累计差额及 cache-write 别名口径，按父子继承前缀排除回放。OpenCode SQL 只投影用量、模型、provider、费用和时钟，计入 compaction 调用但不把它计作逻辑消息。旧缓存继续可读并重扫仍存在的日志，已删除的原始日志无法恢复会话用量归属。

Schema 9 保存 Claude 的命名元数据，custom-title 优先于 ai-title。会话活动接口另外读取 Codex session_index.jsonl 的 thread_name、最新 state 数据库的 threads.name，以及 OpenCode session.title；独立改名无需 Token 日志追加即可生效。Codex 不读取可能包含提示词的 title / first_user_message 列，所有来源都不截取聊天正文生成标题。标题清理控制字符并限制为 200 字符；只挂到已聚合出的会话。界面以会话名称为主、项目为副标题，缺名时使用 Agent 和短会话 ID。首页保留 6 条，全量会话在弹窗内按名称、项目、模型、ID 搜索并按 Agent 筛选，每页 12 条。

`GET /functions/tud-session-activity` 使用与主面板相同的日期及 Agent 筛选，返回最近活动、上下文、逐会话 Token 与按事件计费归属。上下文容量只采用来源明确记录的数字，最近请求输入标为估计；Claude 压缩后采用 postTokens，没有该数字时清除旧占用，显示压缩后用量未知。最近活动不证明 Agent 正在执行。贡献名为“本机 Token 消耗占比”，保留未归属 Token；会话与桶口径不一致时明确标记并用两者较大的总量作为分母。

provider 和认证类型分别保留；普通 OpenAI/Anthropic 名称不能证明订阅。会话内切换渠道时逐事件归属，不把整段会话算给最后一个服务。来源记录费用、按当前价格估算、混合/缺失分别标注；Claude cost-state 的会话费用覆盖同范围请求估价，部分模型金额未知时保持不完整。来源金额不等于实际账单。账号仅保留本地不可逆关联键，有相同账号证据时关联额度 profile 名称，不用当前登录状态反推旧会话付费方式。不提供会话级缓存诊断。

Codex 的明确 chatgpt 认证标记，或 OpenAI 来源事件中已知的 rate_limits.plan_type，可作为订阅/API 证据；显式认证优先，缺少限额或不认识的套餐值仍保持未知。列表省略重复的未知渠道字样，展开后说明缺少认证/套餐证据；计费汇总仍保留未知桶。

任务执行时长使用独立的工作事件时钟，不改变消息数、会话数或总时长。Codex 按 `turn_id` 配对任务，优先使用 `task_complete.duration_ms`，缺失时用任务开始与完成/取消事件的时间差；真实 turn UUID 的跨文件/继承副本只计一次，旧格式任务标签按会话隔离。进行中或缺少结束证据的任务不通过下一次 prompt 补全。任务时长包含 TTFT、思考和工具执行，不能将减去第一次 TTFT 后的数值称为纯生成时长。

其他 Agent 以真实用户消息划分回合，累加用户消息到该轮最后工作事件的跨度，并明确标注“估算”。工作事件包括已核实的助手输出、思考、工具及步骤进展；排除设置、元数据、usage 与注入事件。OpenCode/ZCode 使用消息 created/completed 以及助手归属的 text/reasoning/tool part 时钟；Antigravity 使用 model 的 created/completed 时钟。估算可能包含排队等待。消息统计仍只计用户和 AI 逻辑消息。

任务区间按本地日期窗口裁剪，跨午夜只累计窗口内的部分；总时长继续按范围内首末消息计算。接口 `taskSeconds` 提供任务时长，`taskTimingKind` 区分 recorded/estimated/mixed/empty/unavailable，附带估算与缺失计时的来源。旧 `activeSeconds` 保留原助手消息跨度估算以兼容接口，面板改用 `taskSeconds`。Schema 4 会独立补扫历史工作事件，保留原始日志已经删除的消息元数据；只持久化身份、事件类别和时钟，不保存正文。

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

维护底表使用 `pnpm sync:pricing`，请求自动读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（也支持小写形式），不需要额外设置 `NODE_USE_ENV_PROXY`。`_meta.generated_at` 记录本次生成的实际 UTC 时间，页面按本地时区显示；它不是供应商调价时间，也不再固定为当天 UTC 零点。

同步从 models.dev 的 `catalog.json` 同时读取 provider 调用 ID 和标准模型元数据。`model_metadata` 保存 `display_name` / `canonical_model_id`，价格页按调用 ID、展示名与标准模型 ID 搜索，保留不同渠道及 highspeed 等调用变体。经明确名单核实的厂商 Coding / Token / Step Plan 保存在独立的 `subscription_models` 目录，缺少 cost 仍可收录；上游的零值或非零占位费率均不进入 `exact`，不影响按 Token 的费用估算。名单不能仅凭 provider 名称包含 plan 或 cost 为零来扩大。两条历史人工补充的 `moonshotai/kimi-for-coding*` 费率仍供原有费用估算使用，公开目录由当前 Kimi Code 订阅渠道取代。

Dashboard 与 Desktop 共享价格页及目录转换，订阅行显示“订阅制 / 按套餐额度使用”，不显示为免费 API，也不参与 API 单价排序。官方套餐由销售平台归类，套餐内的第三方模型不因此成为模型原厂 API；标准名关联只用于目录展示和搜索，不作为费用匹配 alias。

[每日价格同步](../.github/workflows/sync-pricing.yml)计划于北京时间 09:23 运行，也支持手动触发。任务使用 `pnpm sync:pricing --if-changed`，仅当模型费率或元数据有实际变化时生成新表，由 `github-actions[bot]` 提交并推送默认分支；数据未变时保留原文件和生成时间。该任务需要 `contents: write` 权限，并遵守仓库的分支保护规则。

费用卡的说明按当前日期和 Agent 筛选读取 `/functions/tud-usage-report`，展示来源报告金额、费率估算、默认价格占比、未计价 Token、匹配模型/方式和表来源。价格日期来自表内发布时间元数据，缺少时明确显示未知，不使用进程加载时间。已有费用数值算法保持不变；报表另提供 `costUsd=null` 和 `knownCostUsd` 区分不完整价格与已知小计。

本地费用卡金额与说明共用报表的已计价小计，加载或失败时显示占位，全部未计价时显示“未知”。Agent 筛选后的旧趋势数据按 Token 占比分摊费用，不能作为各模型费率汇总，因此费用卡不再用该比例生成筛选后的金额、迷你趋势和比较徽标；其他趋势图仍沿用原有口径。异步说明绑定筛选条件及概览数据版本，刷新或快速切回旧筛选时不会展示过期报告。

桶的可选 `token_quality` 独立记录 `recorded`（日志字段）、`estimated`（文本估算）、`ledger`（无完整拆分的补差）或 `mixed`。仅在解析器有明确证据的入口标记，缺字段的旧记录在报表中归 `unknown`；合并不同来源或已知与未知证据时归 `mixed`，不事后猜测明细比例。

价格页默认“最新旗舰”，并保存用户的排序选择。`pricing.json` 的 `model_metadata` 按定价 ID 保存 `release_date`、`release_date_source` 和人工维护的 `featured`；`pnpm sync:pricing` 同步 models.dev 的首次发布日期并保留主推标记。手动校正日期时把 `release_date_source` 改为官方公告链接，同步会保留该日期；新型号替代旧型号时需要撤销旧条目的主推标记，同一个型号只选一个主要版本。主推模型排在前面，各组按发布日期降序，未知或无效日期排在所属组末尾。发布日期与价格表更新时间含义不同，不得相互代替；已发布远端表比内置表旧时，页面保留较新的内置表。

“我的常用”使用固定近 30 天的模型 Token 用量，先按 `{source, model}` 解析到准确定价 ID，再跨 Agent 汇总。身份解析使用精确名称、明确的来源别名及无歧义的规范化，不采用费用估算的模糊匹配或默认价格，保留 fast/flex/batch 和独立快照等计价条目。用量请求独立于价格目录；无可匹配用量或请求失败时，价格仍可查看并暂按最新旗舰排序。Desktop 共享价格页通过显式适配器读取 IPC 用量，不依赖浏览器 HTTP 端口。

## 日历、封存与配置写入

队列时间使用 UTC，面板日期分组使用 [timezone.ts](../packages/core/src/timezone.ts) 的本地日历规则。今天实时计算，过去日期读取封存缓存。启动时补齐有记录但未封存的日期；跨午夜或休眠多日后，即使同步没有写出新桶，也要触发日历封存检查。历史桶变化时重封受影响日期。

证据：[AggregateCache](../packages/core/src/aggregate-cache.ts)、[缓存测试](../packages/core/test/aggregate-cache.test.ts)、[createApplyAfterSync](../packages/core/src/server/state.ts)。

配置初始化、保存和运行时完成时间都经过 [config.ts](../packages/core/src/config.ts) 的跨进程锁。后台任务完成时先读最新配置，只更新自己的 `lastSyncAt`；设置保存也保留较新的运行时时间。临时文件与 rename 负责完整写入，Windows 的占用错误有重试，不能直接对 `config.json` 并发覆盖写入。

证据：[配置并发测试](../packages/core/test/config-concurrency.test.ts)。其中并发读取压力用例在 Windows 跳过，不能把其他平台的通过结果当作该分支的实机验证。

## 成就与个人足迹

成就使用完整的已采集队列与会话历史，独立于面板筛选和内存统计下限；跨进程状态保存、系列阈值、项目覆盖、费用与会话跨度口径、分享隐私见[成就说明](./achievements.md)。规则测试覆盖日历边界与历史回补，存储测试覆盖多进程领取、永久保存和损坏文件处理。

项目成就优先使用仓库根，关联 worktree 与子目录合并，独立同名仓库保持分离；无明确项目配置的目录需手动确认。同日跨 Agent 或手动合并的项目按日期集合去重。Schema 6 回补项目根与旧身份别名，原始收藏保留，手动合并、命名和忽略为可撤回的独立设置。主页的系列数、对象数与实际徽章数分别统计。
