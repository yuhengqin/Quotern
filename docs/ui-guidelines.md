# UI 组件与交互规范

适用于 `packages/dashboard/src` 和 `apps/desktop/src/renderer` 的新增页面、组件和交互修改，以及 Desktop 的托盘、通知和宠物用量提示。先读总则；涉及数字展示时再读「用量数字与模型单价」，其他任务按需阅读组件清单及对应交互章节。本文维护展示契约、现役入口与适用边界；第三方 API 以根 AGENTS.md 指向的 `.heroui-docs/react` 为准。

## 总则

1. 按交互语义选择组件：先查下面的现有入口，适用时复用；能力不足时先评估扩展参数或组合，再决定新增。不要仅凭文件位于 `components/` 或名称相似，就认定可以通用。
2. 公共基础组件负责尺寸、溢出、焦点、键盘和可访问性等共同约束；业务组件负责数据、筛选值、指标含义及“全部/空选”的解释。抽取公共 UI 时保留原有信息、交互、错误/空状态和应用时机。
3. 同名文件可能是独立副本，也可能是 re-export。修改前核对实际 import：共享实现改源文件；独立副本分别处理和验收。共享浏览器模块保持 browser-safe；Desktop 引用 Dashboard 新组件时同步检查 `index.css` 的 `@source`。
4. 采用独立实现或绕过公共入口时，在变更说明中记录：现有组件为什么不适用、替代方案仍需保持的约束、验证结果。无需为正常参数配置额外建立审批流程；改变原有能力时遵守 AGENTS.md 的功能保留要求。
5. 新增、调整、移动或弃用公共入口时，在同一变更中更新本清单、适用边界和示例/调用点。组件实现是行为依据，本文是选择与维护入口。

## 用量数字与模型单价

这是新增、修改和审查数字展示时必须遵守的产品契约。覆盖总览、会话列表与详情、模型明细、图表坐标轴/标签/Tooltip、分享卡片，以及 Desktop 托盘、通知和宠物用量提示；两端同类数据使用同一规则。检查现有实现时，必须区分代码当前行为与本节要求，不因文档存在就声称存量页面已经全部符合。

### Token 数量

- 所有只读 Token 数量（包括输入、输出、缓存、推理、合计、场景估算用量和上下文容量）跟随已有「Token 数量格式」设置：`localized` 随界面语言使用本地化单位，`international` 使用 K/M/B/T。不得在新页面硬编码其中一种，也不得绕过设置直接展示大整数。
- 复用现有单位阈值、舍入和跨级进位逻辑。例如 `3,684,765` 在中文本地化设置下显示 `368.5万`，国际设置下显示 `3.7M`；不足当前单位阈值时保留整数并按当前语言分组。不要为了显示一致而重写另一套数量算法。
- 页面、弹窗、图表提示和分享内容保持相同偏好；设置生效后，相关展示应同步更新。会话用量不新增精确值切换、悬停原值或复制数值入口。

### 用量费用

- 用量统计的费用币种为 USD，统一使用 `$` 前缀，最多保留 **2 位小数**，按四舍五入显示并去掉末尾多余的零。例如 `1.4221 → $1.42`、`1.4 → $1.4`、`1 → $1`、`0 → $0`；不追加 `USD`，不改用 `¥`，不以 K/M/B/T 缩写金额。
- 正费用满足 `0 < value < 0.01` 时显示 `<$0.01`，只有已知为零才显示 `$0`。未知、不可用或非有限数值显示 `—`，不能误作零费用。负数如由业务明确支持，保留负号并按相同精度处理；极小负数使用 `>-$0.01`。
- 部分计价保留「已知小计」和未计价说明，不将小计表示成完整总额。已有下界展示保留 `≥`；非零已知小计不足 `$0.01` 时使用 `> $0` 并保留不完整说明，避免给出错误的下界。
- 同一 USD 金额在卡片、列表、详情、图表和分享中使用同一格式，不因组件或端不同而改变精度。小数点和分组分隔符跟随支持的界面语言，`$` 与 USD 的币种含义保持不变。
- 以上舍入仅用于展示。采集、存储、聚合、排序、占比计算与 CSV/API 导出继续使用原始数值；先汇总原始费用再格式化，不累加已经舍入的展示值。编辑输入框仍使用可编辑数值，不放入紧凑单位或阈值字符串。

### 模型单价与价格页换算

- 模型单价与累计费用分开处理，不套用「最多 2 位小数」的费用规则。价格列表和比较中的单价沿用 **最多 4 位有效数字**，例如 `$0.0001234`；必要时保留已有 `≈` 标记和单价详情，以免低价模型被显示成零。
- 通过金额旁的单位、列头或紧邻说明，明确标注真实计价基准，例如 `/1M tokens`；按次、图片等价格保留各自单位，不统一冒充 Token 单价。固定报价基准及对应费率不随 Token 数量格式设置改变，单位文案可按界面语言翻译；单独展示的 Token 用量和上下文容量仍遵守上一节。
- 保留价格页已有 USD/CNY 选择和真实汇率换算：USD 使用 `$`，CNY 使用 `¥`；汇率或价格不可用时按既有语义显示 `—`。价格页场景估算的总费用使用所选币种和费用的最多 2 位小数规则（极小非零值使用该币种的 `0.01` 阈值），不能误用单价的 4 位有效数字规则。

### 复用入口与验收

| 能力 | 现有入口 | 适用边界 |
| --- | --- | --- |
| Token 数量与保存的偏好 | [lib/utils.ts](../packages/dashboard/src/lib/utils.ts) 的 `formatCompactTokenCount`、`getTokenUnitMode`，以及 [lib/format.ts](../packages/dashboard/src/lib/format.ts) 的 `formatTokens` | Desktop 的同名入口位于 `apps/desktop/src/renderer/lib`；修改前核对独立副本或 re-export。缺失值由业务按数据语义处理，不能用格式化工具的数值 fallback 代替未知状态 |
| USD 费用 | [lib/format.ts](../packages/dashboard/src/lib/format.ts) 的 `formatUsd`；Desktop 有同名入口 | 修改或扩展时必须满足本节的精度、去零、阈值和未知值规则。业务组件不自行拼接货币单位或调用 `toFixed` / `toLocaleString` 决定费用格式 |
| 模型单价 | [lib/pricing-display.ts](../packages/dashboard/src/lib/pricing-display.ts) 的 `formatPricingDisplayRate`，由 [PricingDetails](../packages/dashboard/src/components/PricingDetails.tsx) 等调用 | 只负责单价与币种换算，不作为累计费用格式化入口；Desktop 随共享价格组件复用 |
| 价格场景总费用及差额 | 同文件 `formatPricingCost` 先换算再调用 `lib/format.ts` 的 `formatCost`；`formatUsd` 保持 USD 包装 | `formatCost` 两端有独立副本；金额和差额统一最多两位小数、极小非零阈值及未知值。单价继续使用上一行入口 |

现有入口不适用时先扩展或组合公共能力；经典 DOM、主进程等运行环境不能直接导入 renderer 模块时，说明适配边界并保持同一展示契约，不能各自另定规则。审查新增格式化函数及其调用点时，同步核对这些入口与两端副本。

`formatCompactTokenCount` 可通过第三个参数指定界面语言，仍默认读取同一个单位偏好；价格页上下文、场景摘要与个人用量、成就进度与分享均复用此入口。固定报价基准和可编辑输入的百万 Token 基准不随偏好改变。

验收至少覆盖：切换本地化/K/M/B/T 后相关展示实际更新；零、极小非零、普通金额、未知值和部分计价；同一数据跨组件与两端同格式；模型单价、报价基准和 USD/CNY 切换保留；CSV/API 数值精度不受展示舍入影响。文档更新本身不能代替代码检查或真实页面验收。

## 信息呈现与默认界面

本轮新增入口：共享 `AgentIntegrationSettings` 用于两端的「Agent 集成」，默认关闭的功能与 Hook 安装状态分别呈现；`SessionHandoff` 在会话详情按需展开，先生成可编辑预览再复制/保存。共享 `PaletteControl` 承接配色选择，`PaletteRuntime` 在两端 ThemeProvider 中应用并监听跨窗口偏好；系统/浅色/深色规则保持。共享 `QuotaLayoutControl` 与 `QuotaLayoutCards` 提供订阅卡片原位排列，`useQuotaLayout` 管理草稿及统一保存；Desktop 直接引用这些组件并登记 CSS `@source`。

交接预览的目录、日志、集成配置和本机访问失败在操作附近说明原因及下一步；重试和保存失败保留草稿，复制失败提供手动复制提示。两端使用同一 `SessionHandoff`。预览复用已采集会话的文件定位，不把用量索引按小型 Agent 配置的大小上限处理；只在显式预览时读取有限日志尾部。

`UsageInsightsPanel` 从当前报表读取最多三项结论，并带范围进入会话页。`SessionDiagnosticsSection` 在会话详情区分工具记录、粗略输出体积和推断关联，具体证据按需展开。Desktop 托盘按需显示额度摘要。主窗口提供完整用量、筛选、额度排列和监控目录。额度排列的「紧凑卡片」只调整间距，额度信息和详情入口仍可访问。 [TrayPopoverView](../apps/desktop/src/renderer/components/TrayPopoverView.tsx)

布局编辑从铅笔图标加「编辑布局」文字按钮进入，编辑时才显示抓手图标、「…」移动菜单及简短说明。按用户明确要求，编辑时整张卡片（包括紧凑状态行）均可用鼠标/触摸拖动，保留抓手提示；按钮、链接和输入区域不触发拖动，编辑卡片区域使用 `touch-action: none`，卡片外仍可滚动，拖到边缘时自动滚动。正常浏览仍保留卡片正文的滚动、选文与详情行为。拖动中的真实卡片跟随指针，原槽位保留，蓝色插入线显示落点，释放后改变真实 DOM 顺序。菜单复用 `FilterMenuPopover`，提供「移到最前 / 上移 / 下移」的非拖动替代；把手支持方向键、Home / End，移动后按订阅 ID 恢复焦点并播报位置。Escape 取消当前拖动；把手非拖动状态下 Escape 退出编辑。排序不使用收藏星标。

顺序与紧凑模式先本地预览，点「完成」一起保存，点「取消」丢弃草稿。保存中显示状态并禁用重复提交，失败保留草稿、显示就地错误及「重试保存」。后台读数刷新保留编辑草稿；保存可见卡片顺序时保留暂不可见账号 ID。额度与纯状态订阅统一按 ID 排序，允许逐项跨类型移动；相邻纯状态项仍合并为紧凑组，组内按纵向落点排序，不再强制置后。编辑中的卡片不打开详情，浏览状态保留详情、重试及服务入口；Desktop 的通知精确定位和托盘摘要不改变。两端共用 `components/quota-layout.css`，验收入口为 `corepack pnpm test:island-ux-ui [全新输出目录] --quota-layout-only`，包含整卡鼠标/触摸、状态组内与跨类型移动、键盘移动、取消、失败重试、刷新保留与窄屏；仍需实际浏览器体验。

1. **先确定用户要判断或执行什么。** 正文优先展示结果和动作，不按 DTO 字段顺序铺开页面。新增一行文字、标签或说明时，确认它是否改变用户当前判断；默认界面没有这种价值的内容进入按需入口。
2. **默认配置不制造标签。** `standard`、`unknown` 等无区分价值的服务档位不显示，也不生成空白副行；非默认档位才补充标识。这条针对配置/身份标签，不适用于记录到的零值；未知测量值保持未知，不伪装成零。
3. **汇总必须有新增价值。** 单模型与整体用量/费用一致时省略合计行；多模型或存在未归属差额时保留合计。主汇总使用一个视觉重点，表内合计与分项对齐，用普通背景和轻分隔线，不叠加第二块强调卡片或整行重底色。
4. **说明放在问题发生的位置，默认收起。** 指标定义、统计口径、样本与覆盖、缺失字段清单、计价匹配规则等，使用相邻、可点击且支持键盘的帮助浮层。长说明不常驻正文，不用悬停 Tooltip 承载长文或链接，也不在折叠标题重复完整摘要。实际失败、待处理问题、未知/已知小计和影响判断的异常保留简短状态，详细原因按需展开。
5. **复用业务目的地。** 参考价格在新标签页进入价格页，保留原页面与弹窗，携带明确、可清除的模型筛选；Desktop 使用带原有 IPC 数据连接的独立价格窗口；不能把多个模型拼成模糊搜索，不能在匹配失败时静默退回全部目录。参考价和会话费用依据分别表达，不把当前目录当作历史账单。会话详情不展示 `overlay`、`prefix-strip`、匹配模型、匹配方法或规则引用等技术依据；费用来源、未知/未计价状态和影响金额的估算假设仍保留。
6. **保留可访问性与单一事实来源。** 将说明移入帮助不等于丢弃信息；入口有可理解名称，鼠标/键盘/触屏可打开，Escape 关闭并恢复焦点。通用规则维护在本节，AGENTS 仅引用；具体反例和自动验收归入现有测试，不维护另一份平行“错题本”。

| 必验案例 | 默认界面 | 按需查看 / 异常处理 |
| --- | --- | --- |
| 单模型、完整归属 | 一条模型行，无重复合计，无 standard 标签 | 输出与其中推理关系保留 |
| 多模型或未归属差额 | 表尾合计，数值与分项对齐 | 缺分类与未分配金额可查询，未知不变成零 |
| standard / unknown / fast 混合 | 只显示 fast，不留空副行 | 原始记录保留，不改变采集与计费 |
| 指标定义、样本与缺失清单 | 数值与必要的短状态 | 相邻帮助入口，无大段常驻说明 |
| 查看本会话价格 | 只显示准确匹配的会话模型，可清除筛选 | 未匹配明确提示，不扩大结果；价格依据仍可主动查询 |
| 无模型明细 | 一条缺失状态，不绘制八列空表；摘要中的已知数值保留 | 未分配模型 Token、会话金额和已知小计仍可查询，零与未知有区别 |
| 响应指标缺少样本 | 两项均缺失时合并一条提示；单项缺失单独表达 | 有效的 0 tok/s、0 s 保留；帮助仍提供样本与定义 |
| 单成员 / 多成员关联 | 单成员直接显示名称链接、关系、角色及用量；多成员保留汇总折叠 | 不重复单成员数值，不丢失历史链接或分叉身份 |
| 正常短指标与元信息 | 活动宽屏最多三列/窄屏两列；会话信息宽屏双列/窄屏单列 | 长标签可换行，长数值在紧凑视口跨列显示，避免拆散数字分组；不能以截断隐藏真实值 |
| 单档 / 多档模型价格 | 每个模型行默认收起，展开同一行下方的“计价项目 / Token 用量 / 单价（/1M Token）/ 分项费用”；不同有效单价及缓存 TTL 分行呈现 | 当前参考价仍进入价格页；费用来源、假设与未分配金额保留。仅有记录总额或旧 runtime 时不虚构分项费用；技术匹配依据不再展示 |

## 组件清单

以下路径以仓库根为起点。清单覆盖现有主要 UI 入口，不代表所有业务组件都已通用化，也不代表独立副本逐字一致。

### 公共基础与应用入口

| 能力 | Dashboard 入口与使用点 | 适用边界 | Desktop 方式 |
| --- | --- | --- | --- |
| 页面布局 | [AppShell](../packages/dashboard/src/components/AppShell.tsx)，由 `routes/__root.tsx` 注册 | 根路由的宽度、滚动容器、Provider 与全局弹层；页面通过 Outlet 接入 | 独立 `AppShell`，保留窗口/托盘差异 |
| 顶栏图标操作 | [FilterChromeActions](../packages/dashboard/src/components/FilterChromeActions.tsx) 与 [AchievementEntry](../packages/dashboard/src/achievements/AchievementEntry.tsx) 共用 [chrome-action-styles](../packages/dashboard/src/components/chrome-action-styles.ts) | 图标按钮与导航链接统一 32×32、16px 图标、圆形 tertiary 背景和居中布局；保留链接语义、Tooltip、焦点、禁用状态及成就未读点。Desktop 更新文字按钮保留独立状态与样式 | 独立 FilterChromeActions 引用同一样式；AchievementEntry re-export，index.css 登记共享样式 `@source` |
| 筛选菜单浮层 | [FilterMenu](../packages/dashboard/src/components/FilterMenu.tsx)，价格、会话、总览 Agent、趋势、分享范围等使用 | 单选、多选、可搜索列表和自定义选项列表的公共尺寸/滚动外壳；详见下一节 | [本地 re-export](../apps/desktop/src/renderer/components/FilterMenu.tsx)，共用同一实现 |
| 持续状态提示 | [StatusBanner](../packages/dashboard/src/components/StatusBanner.tsx)，DashboardPage、PricingPage、SettingsPanel 使用 | `info/warn/error/success` 状态与说明；操作完成的短暂反馈使用 Toast | 同名独立副本 |
| 设置帮助说明 | 浏览器设置维持现有说明布局 | 标题旁的独立信息按钮，悬停显示入口名称，点击打开可阅读、可含链接的说明浮层；触发器不放入 Checkbox / Label 的点击区域，关闭与焦点恢复沿用 HeroUI Popover。规则与背景可按需查看，实际状态、错误和操作反馈仍直接显示 | [SettingsHelpPopover](../apps/desktop/src/renderer/components/SettingsHelpPopover.tsx)，用于 QuotaSettings 的提醒与分析、周额度参考节奏、订阅通道，以及 SettingsPanel 的 Token 数量格式和 PetSettingsCard 的导入宠物；解释性浮层不套用 FilterMenu |
| 应用 Toast 队列与展示 | [AppToastContext](../packages/dashboard/src/components/AppToastContext.tsx) 提供队列；[AppToastRegion](../packages/dashboard/src/components/AppToastRegion.tsx) 与 [app-toast.css](../packages/dashboard/src/components/app-toast.css) 统一 AppShell、分享卡片和设置中的右上角提示 | `useAppToastQueue` 必须位于 Context Provider 内；短提示按内容收缩，长提示最多 24rem 且不超过视口减去两侧各 1rem，完整换行。保留 HeroUI 图标、加载、操作、关闭、堆叠与自动消失；局部队列可保留，价格页比较数量提示仍使用顶部居中 240px 的专用布局 | 独立 Context；`AppToastProvider` re-export 共享展示。main.tsx 在 document root 发布共享标题栏高度，index.css 将所有共享 Toast 放在标题栏下方 1rem，涵盖 body portal 中的分享/设置提示；托盘浮窗不预留标题栏 |
| 按需帮助 | [HelpPopover](../packages/dashboard/src/components/HelpPopover.tsx)，SessionDetailDialog、SessionUsageBreakdown、PricingPage 使用 | 标题旁独立图标，Tooltip 只提示入口名称，点击 Popover 阅读定义、依据或覆盖信息；共享壳负责视口边界、焦点和 Escape，不使用筛选菜单外壳。现有 SettingsHelpPopover 是 Desktop 设置专用，CostExplanationLabel 绑定费用业务，均不适合直接承载共享会话指标 | 直接引用 Dashboard 实现，并在 index.css 登记 `@source` |
| 图表基础 | [ChartPrimitives](../packages/dashboard/src/components/ChartPrimitives.tsx)，TokenUsageTrendCard、UsageDistributionCard 等使用 | Recharts 容器、主题、Tooltip/Legend；数据转换与指标含义留在业务图表中 | 同名独立副本 |
| 堆叠图模型明细 | [UsageRowDetails](../packages/dashboard/src/components/UsageRowDetails.tsx)，ToolModelUsagePanel、ProjectUsagePanel 使用 | 整行作为点击和键盘入口，Popover 显示完整名称、原始费用格式化结果及本行模型占比；图形保持真实比例，极小条段也可经整行查看。保留鼠标模型提示，Escape、滚动或缩放关闭悬停提示 | Desktop 两个独立面板直接引用共享明细组件，并登记 CSS `@source` |
| Agent 来源图标 | [ProviderIcon](../packages/dashboard/src/components/ProviderIcon.tsx)，会话、项目和 Agent 选择器使用 | Agent/采集来源标识及 fallback | 同名文件，分别核对资源与平台能力 |
| 模型厂商图标 | [ModelProviderIcon](../packages/dashboard/src/components/ModelProviderIcon.tsx)，价格列表与比较使用 | 模型厂商及渠道标识；不要替代 Agent 来源图标 | 随共享价格组件引用 Dashboard 源文件 |
| 订阅品牌图标 | [SubscriptionBrandIcon](../packages/dashboard/src/components/SubscriptionBrandIcon.tsx)，QuotaUsageCard 使用 | 订阅品牌（含 Gemini CLI）；与 Agent/模型厂商有不同语义与资源集合。品牌文字已在卡片中显示，图标使用空 alt / aria-hidden | 独立实现，Desktop 支持的品牌/资源更多；新增通道时同时登记两端品牌资源 |
| 订阅额度与服务详情 | [QuotaUsageCard](../packages/dashboard/src/components/QuotaUsageCard.tsx) 与 [QuotaServiceDetails](../packages/dashboard/src/components/QuotaServiceDetails.tsx)，SubscriptionUsageGrid 使用 | 主卡保留额度窗口、异常和紧凑状态；详情承载全部窗口、趋势、来源、服务组件与事件。重置时间默认倒计时；卡片与详情直接点击时间文字切换日期/倒计时，沿用全局 resetTimeMode 偏好，不再提供独立切换按钮。公共重置时间与窗口重置/到期时间使用相同入口，支持键盘 Enter/Space，保存期间保留焦点、防止重复提交，失败保持原显示并就近反馈；无保存能力时保持静态文字。经过截止时刻仅提示等待读数更新。节奏刻度按“剩余”方向换算，过期读数、已到期窗口和非额度余额不显示刻度。服务筛选复用 FilterSelectPopover：未配置表示全部，空数组表示尚未选择，未知与过期不得显示正常。保存失败保留原值并在详情反馈；Claude 金额和赠送权益保留官方用量页入口，平台实际读数从总览「实际消费」按需查看 | Desktop 的 QuotaUsageCard 适配 IPC 保存与原生外链，复用 Dashboard 实现；index.css 登记共享组件 `@source`。两端保存 resetTimeMode 与 serviceComponents，服务筛选按厂商共用 |
| 外观偏好 | [ThemePreferenceControl](../packages/dashboard/src/components/ThemePreferenceControl.tsx) 与 [PaletteControl](../packages/dashboard/src/components/PaletteControl.tsx)，SettingsPanel 的「常规设置」中紧随语言设置 | 外观模式和强调色各自单选并立即保存。模式卡预览跟随系统、浅色和深色，强调色卡按实际明暗显示全部配色；卡片显示名称和勾号，键盘焦点单独呈现，窄窗口自动换行。位于运行配置之前，不依赖配置读取成功。FilterChromeActions 不再提供主题按钮；存量 ThemeToggle 仅供旧页面使用 | Desktop「常规设置」直接复用控件和样式。各端主题 hook 负责模式解析与保存，Desktop 保留主进程系统外观广播；切换明暗或跟随系统不重置强调色 |
| Desktop 设置导航 | Desktop 专用布局 | 左栏依次为「常规设置」、「宠物」（Windows）、「订阅」、「Agent 集成」、「数据与备份」、「应用」、「关于」。常规设置包含主题、配色、语言和 Token 数量格式；数据与备份包含本地备份、恢复及设备信息；应用包含启动、托盘选项及更新。当前栏目整行高亮，右栏独立滚动。检查最小窗口、长语言标签、方向键与栏目直达入口 | [BackendConfigModal](../apps/desktop/src/renderer/components/BackendConfigModal.tsx) 承载 [SettingsPanel](../apps/desktop/src/renderer/components/SettingsPanel.tsx)，复用 HeroUI 垂直 Tabs |
| 关于与仓库链接 | [AboutContent](../packages/dashboard/src/components/AboutContent.tsx)，设置「关于」与 AboutModal 使用 | GitHub 仓库链接位于版本信息下方，保留反馈和支持的 Agent 信息；仪表盘操作区不再单独展示仓库按钮 | 同名独立副本；仓库链接经原生 openExternal 打开 |
| 应用更新 | 浏览器端不提供桌面更新操作 | Desktop 构建策略决定自动或手动更新，不由运行时环境变量控制 | [AutoUpdateAction](../apps/desktop/src/renderer/components/AutoUpdateAction.tsx) 与 [SettingsPanel](../apps/desktop/src/renderer/components/SettingsPanel.tsx) 复用 shared/auto-update 的操作语义；macOS ad-hoc 显示「手动更新」/「前往下载页」及说明，不声称已发现新版本，不显示检查/下载/安装进度；signed 和 Windows 安装版保留自动更新，Windows portable 保留新版本提示与下载页入口 |
| 网页设置导航 | [BackendConfigModal](../packages/dashboard/src/components/BackendConfigModal.tsx) 承载延迟加载的 [SettingsPanel](../packages/dashboard/src/components/SettingsPanel.tsx) | 左侧依次为「常规设置」、「Agent 集成」、「数据与备份」、「关于」，常规设置首次默认选中，普通重开保留当前栏目。复用 HeroUI 垂直 Tabs，右栏独立滚动；窄屏缩窄侧栏并显示文字标签。旧 `app` 事件进入常规，旧 `sync` 进入数据。演示隐藏 Agent 集成入口，数据栏目保留可读设备信息；备份、恢复及用量恢复沿用共享组件的能力检查 | Desktop 保留独立栏目和原生能力，同类侧栏的行高、间距与高亮方式一致 |
| 语言偏好 | [LanguagePreferenceControl](../packages/dashboard/src/components/LanguagePreferenceControl.tsx)，SettingsPanel「常规设置」使用 | 四种语言单选，系统语言对应项标记“自动”并保存 `system`；`systemLocale` 独立于当前界面语言 | Desktop「常规设置」直接引用，系统语言由主进程提供 |
| 桌面宠物设置与原生托盘入口 | 浏览器端不提供 | 标题行提供唯一的「启用」开关；其下的通用区提供唯一的「大小」控件，修改当前已应用宠物系统的尺寸，切换预览不改变该控件的目标，两套系统仍各自保存尺寸；角色卡片仅切换预览与编辑对象，详情预览当前宠物时显示不可点击的「✓ 当前宠物」状态标记，预览其他宠物时通过「设为当前宠物」按钮明确应用；应用成功后同步更新当前状态，不额外显示全局「已设为当前宠物」成功提示。卡片边框表示预览对象，文字标记与标题状态显示当前宠物。两套宠物保留独立配置与生命周期，应用其他宠物时保留总开关状态，启用时互斥；关闭后保留当前系统、角色与设置，重新开启（含重启应用后）恢复已应用宠物，不跟随最后预览对象。导入成功仅预览新角色。托盘通用宠物开关恢复当前宠物，单独大肥鱼入口仍可直接启停大肥鱼。原生系统菜单使用 Electron Menu，不套用 FilterMenu；名称固定为「大肥鱼」，单击复选项切换唯一大肥鱼及后台任务的开关，历史网页显示位保留 | Windows 的设置侧栏包含「宠物」；首次打开默认展示「宠物」，后续打开保留已选页签，宠物右键设置入口直接定位「宠物」。[PetSettingsCard](../apps/desktop/src/renderer/components/PetSettingsCard.tsx) 由独立「宠物」页签承载，在同一卡片中展示内置/导入角色与大肥鱼，后者嵌入 [DshPetSettingsCard](../apps/desktop/src/renderer/components/DshPetSettingsCard.tsx)；切换编辑对象保留表单草稿。各角色详情统一以角色名、「预览」标签及当前状态标记或应用按钮组成标题行，不重复展示通用介绍文案。大肥鱼的普通启停状态由顶部统一展示，详情只补充启动中、运行错误与重试入口。大肥鱼角色卡片名称固定显示「大肥鱼」，不显示 dsh-pet 副标题，保留当前宠物标记。大肥鱼直接展示预览与设置，不显示「手动控制／宠物设置」分组标题；预览区下方与其他角色一致，按「平静、思考、多任务、连续使用、庆祝、休息」排列，宽屏单行六项、窄屏两行三项，依次播放「用鲸鱼尾巴拍打地面、舞狮头、原地左转奔跑、堆雪人、点击回应-开心跃动、哈欠连天」。打开大肥鱼预览时立即自动播放默认「平静」动作，系统减少动态效果偏好不抑制该预览；点击状态立即播放对应动作预览，再次点击同一状态从头重播；关闭大肥鱼时仍可预览。不显示原生视频控制条，也不提供额外的播放或查看额度按钮，其余设置组保留折叠。仅编辑单实例，不提供多开或目标选择；提供小、中、大三档，宽度分别为 204/264/364 px，角色可见高度约 91/118/162 px；不提供角落、水平偏移或垂直偏移数字项，也没有聊天入口。[TrayPopover](../apps/desktop/src/main/TrayPopover.ts) 在每次右键打开时读取 [dsh-pet/tray-menu](../apps/desktop/src/main/dsh-pet/tray-menu.ts)，关闭后仍可恢复同一只 |

宠物角色列表固定先展示大肥鱼，再展示 Clawd、Bot、Doro、咕嘎、鸡哥ikun、罗小黑、Monthly salary cat（月薪猫）、小八和导入角色。六个图集角色随应用打包，无需导入或联网；已有相同 ID 的导入记录只显示对应内置选项，保留原有选择及本地文件。不再内置 Sprout、Byte、Ember，也不提供恢复这三项内置角色的按钮。导入角色仍可预览、应用和移除。底部「导入宠物」为两套宠物详情共用，均提供标准 ZIP、Codex 和链接导入，不因预览大肥鱼而隐藏；大肥鱼详情不再重复展示上游署名与许可提示，项目 README 保留相关引用。导入与移除反馈跟随触发操作：ZIP 及本地 Codex 读取反馈在对应按钮下方，链接导入反馈在输入框下方并通过 `aria-describedby` 关联，Codex 选中项导入失败保留选择并在确认按钮下方提示，移除反馈在角色列表下方。展示主进程按语言处理后的具体失败原因，IPC 等异常回退通用提示；重试、改用其他操作或编辑链接时清除对应旧反馈。

大肥鱼独立 helper 的交互与数据入口为 `apps/desktop/scripts/dsh-pet-interactions-runtime.js` 和 `apps/desktop/src/main/dsh-pet/companion.ts`；保留原视频播放器、身体命中及鼠标穿透。该经典 DOM 页面没有 React Provider，提示气泡沿用 helper 实现，不使用 FilterMenu。交互边界：悬停显示今日用量、参考 USD 费用和额度窗口，点击轮换回应动作与本机统计短句，右侧屏幕边缘收起并在悬停后展开（多屏接缝不收边），全画面倾斜遵守 reduced-motion；不增加独立眼神交互，也不使用 mini 素材。

两套桌宠右键共用 `apps/desktop/src/main/pet-context-menu.ts` 的菜单模型和原生 Electron Menu：依次为「打开 Quotern、同步数据、大小、角色、宠物设置、隐藏宠物」，按任务分组；打开动作始终显示主窗口，不切换成含义不清的「关闭 Quotern」。角色菜单包含大肥鱼、内置与导入角色，当前项和大小使用单选标记，大小修改右键所在宠物系统。隐藏保留当前宠物选择与独立尺寸，统一启用入口恢复它。大肥鱼额外保留「查看额度与余额」「动作」；右键不提供回到初始位置、重新加载配置及更多操作入口。固定入口及动作分类跟随应用四语言，用户角色名和素材动作原名保持原文。当前集成不提供网页宠物，右键不显示「仅网页／两者／都不」选项，历史 display 配置仍保留兼容。

大肥鱼原生菜单由 `dsh-pet/helper-adapter.ts` 在拥有宠物窗口的 helper 进程弹出，经认证 RPC 读取最新菜单模型；普通宠物由 PetController 弹出。选择、取消和失败均清除菜单输入占用，恢复身体命中与穿透，保留原手动动画与移动接管。设置入口通过 `shared/settings-navigation.ts` 携带具体宠物和独立请求标识，既定位「宠物」页签，也选择被右键的编辑对象；重复请求仍生效，普通打开设置不重置预览草稿。跨端共享不适用：此菜单只在 Windows Desktop 提供，Dashboard 不增加副本。

### 业务内复用入口

新增诊断与本地数据管理入口均由 Dashboard 实现，Desktop 路由/设置直接引用，并在 `index.css` 登记 `@source`：

| 能力 | 入口与使用点 | 适用边界及共享方式 |
| --- | --- | --- |
| 性能分析 | [PerformancePage](../packages/dashboard/src/pages/PerformancePage.tsx) 与 [PerformanceTrend](../packages/dashboard/src/components/PerformanceTrend.tsx)，两端 `/performance` 与顶栏入口 | 原始样本的首字时间 P50/P95、估算速度、样本数、每日趋势；图例使用业务名称，图面标单位，提示显示对应当天样本数。比较表可排序，未知值始终排末尾；最多四个模型用完整样本同图比较。筛选、比较模型、维度与排序写入 URL；名称筛选对应样本，样本会话有“返回性能分析”并恢复筛选及滚动。未知指标保持 `—`，没有完整分母时不展示成功率 |
| 诊断单选 | [InsightSelect](../packages/dashboard/src/components/InsightSelect.tsx)，性能页与额度历史使用 | HeroUI Select + FilterSelectPopover 的有标签单选组合；空值由调用者解释，继承公共键盘、焦点、尺寸和滚动约束 |
| 额度历史 | [QuotaHistoryPanel](../packages/dashboard/src/components/QuotaHistoryPanel.tsx)，QuotaUsageCard 详情的“当前额度 / 额度历史”页签 | 同一 Modal 内手动激活页签，历史按需读取；关闭后重开默认当前额度。周期选项显示首次观测与当前/已结束/未知状态，完整起止与覆盖在图后详情中保留；首次观测不代替未知开始，同一周期的较早回拨段单独标识。支持本周期、5h/24h/7d/30d、前后及回到现在；双窗口使用实线/虚线与名称，跨周期和回拨段不连线，窄屏可滚动到完整图表。窗口名称复用额度本地化，来源、覆盖和效率限制从相邻 HelpPopover 查看；账号 key 与 AbortSignal 防止旧返回覆盖当前账号 |
| 用户价格 | [ManualPricingEditor](../packages/dashboard/src/components/ManualPricingEditor.tsx)，PricingPage 工具栏及 API 模型行使用 | 行入口预填精确 ID；ComboBox 支持名称/ID 搜索与自定义 ID，复用 FilterComboBoxPopover。USD / 1M 四项输入，留空继承、0 为零价；参考价、当前和修改后基础单价复用 PricingRate，预览遵守价格页 USD/CNY 设置。字段错误关联对应输入；冲突重新读取保留草稿。保存与历史更新分开报告，后台任务失败可单独重试，不重复保存价格；显示有数据的历史日期范围。旧 runtime 保留同步保存契约，失败不伪装成后台任务。完成后焦点回到保存按钮，关闭恢复入口；演示隐藏 |
| 本地备份 | [LocalBackupPanel](../packages/dashboard/src/components/LocalBackupPanel.tsx)，两端「数据与备份」使用 | 创建/下载、文件校验和恢复到新目录；错误与完成结果靠近操作，恢复不切换当前实例，不覆盖现有目录；大文件受明确上限限制；演示隐藏 |
| 账号启动与默认账号 | [AccountLaunchControls](../packages/dashboard/src/components/AccountLaunchControls.tsx)，QuotaProfilesManager 的每个账号行与自动换号设置 | 绑定已监测配置目录打开新终端；默认仅影响 Quotern 启动入口。失败就近反馈，自动换号默认关闭，未知身份不允许开启；Desktop 经原有 re-export 共享并登记 CSS `@source` |
| 账号额度提醒 | [AccountAlertsControl](../packages/dashboard/src/components/AccountAlertsControl.tsx)，共享 QuotaUsageCard 详情使用 | 按 provider 与已验证匿名身份跨目录共用标准、仅耗尽、自定义、关闭规则；全局开关与目录开关仍生效。Select 使用 FilterSelectPopover，自定义阈值显式保存，失败保留草稿；Desktop 登记 CSS `@source` |
| 实时会话观测 | [AgentActivityPanel](../packages/dashboard/src/components/AgentActivityPanel.tsx)，两端总览按需打开，Desktop 托盘按需展开 | 只展示已安装可选 hooks 的项目、工具、状态与观测时长，不推断任务成功。失败/两分钟无新观测降级旧状态，刷新重试不移除已聚焦按钮；关闭停止轮询，页面隐藏暂停。沿用 Agent 集成的活动开关，安装更新由用户显式执行；Desktop 登记 CSS `@source` |
| Claude 实际消费 | [BillingPanel](../packages/dashboard/src/components/BillingPanel.tsx)，两端 SubscriptionUsageGrid | Claude.ai 和 Console 独立连接、状态与草稿；组织选择复用 FilterSelectPopover，说明复用 HelpPopover。已知/未知/不完整及旧读数明确区分，费用复用 formatUsd；明细按日/模型/API key 展开。Desktop 共享组件、IPC 数据入口并登记 CSS `@source`；演示与托盘摘要隐藏，退出布局编辑后恢复入口。操作说明见 [账号与费用](account-launch-billing.md) |

通知会话定位复用共享 `SessionsPage` 与 `SessionActivityPanel.FocusedSession`：URL 的 `sessionSource + sessionId` 进行精确查询，自动打开详情弹窗；`sessionFocus` 让重复点击同一会话也重新定位。该模式不受列表分页/时间筛选遮挡，并明确显示读取的是已采集历史及服务端实际范围；缺记录时保留目标等待常规同步。关闭详情后焦点回到会话行，常规数据刷新不重新打开已关闭的弹窗。Dashboard 与 Desktop 使用同一页面和详情组件，`useSessionActivity` 两端同步支持目标参数，普通会话列表的筛选与关联展开行为保留。
关联会话详情复用同一 `SessionDetailDialog` 内的查看栈：名字点击在当前弹窗显示完整子会话详情，顶部“返回上一会话”逐层恢复父会话的范围选择、原生折叠项、滚动和触发器焦点；关闭退出整个查看链，底层路由与列表保持。辅助独立打开链接在浏览器新标签页、Desktop 同文档 `/sessions` 精确目标窗口打开，保留 IPC；窗口 URL 携带 `sessionPeriod=selected` 和实际期间；共享 `session-activity-query` 将其转换为原有来源＋时间边界查询，再由 `FocusedSession` 按身份定位，兼容旧 runtime。原通知链接仍查询已采集历史。`session-detail-cache` 仅在本次弹窗期间缓存完整会话行，摘要行不作为完整详情；打开主会话、关联名称悬停或键盘聚焦时按精确身份、实际期间及列表来源范围读取，最多并发两个请求，重复身份合并。旧 runtime 404 回退来源快照，并复用其中完整兄弟行；关联用量投影不作为完整活动或操作信息。加载、缺记录和失败仍可返回，失败/缺记录可重试；隐藏的父内容不参与焦点和可访问名称。

浏览器只读演示由 HTML 的 `#quotern-demo` 元数据显式启用，`lib/demo-runtime.ts` 提供参考时钟与独立偏好键；普通浏览器默认实时、Desktop 适配器固定正常模式。AppShell 复用 StatusBanner 展示只读与参考日期；演示保留筛选、详情及内置分享卡下载，隐藏同步和在线额度，成就/服务器图库修改禁用。共享 AchievementProvider 的 `readOnly` 参数默认 false，分享组件的演示检查默认关闭，普通 Desktop 的 IPC、图库迁移和成就写操作保持原行为。只读是服务器 API 的强约束，不能仅靠隐藏按钮。日期包装仅改 Dashboard；独立 Desktop 日期副本继续使用实时时钟。

固定演示关闭统计、成就及图库的定时和 focus/visibility 自动刷新；初次加载、筛选变化、重试和显式同步事件继续读取。两端 `lib/dashboard-refresh.ts` 的 `subscribeAutomaticRefresh` 只管理自动订阅，初载与 `DATA_SYNCED_EVENT` 由调用方保留。Desktop 正常模式保持轮询与原有 IPC 新鲜度探测。

演示会话页固定展示筛选后第一页的 12 条主会话；请求前将页码/容量归一化，并 replace 直达或历史恢复的其他页码。分页仅保留第一页及上一/下一页，隐藏容量和跳页控件；下一页通过应用 Toast 说明演示限制，保持列表、URL 和操作焦点。完整匹配计数、筛选、详情与完整 CSV 导出保留；正常浏览器与 Desktop 的完整分页保持原行为。

浏览器初始入口只注册 shell、usage 和 achievement 翻译；设置、价格和分享的四语言文案在功能模块加载时同步注册，必须先于首次渲染。Desktop 保留完整入口注册。浏览器的设置、关于、成就弹层内容，以及两端共享的分享内容经 `components/DeferredContent` 按需下载，失败提供刷新页面操作（浏览器可能缓存失败的模块导入）；成就加载/错误提示由可关闭的轻量 Modal 承载。轻量宿主始终保留打开事件、选中页签与分享快照，不能延迟订阅而丢失第一次点击。分享内容实现为 `ShareActivityModalContent`，宿主 `ShareActivityModal` 保持原入口。演示总览请求最近六条预览，用完整 `sessionCount` 与账单组计数显示跳转入口；完整会话页和 Desktop 正常模式优先读取服务端轻量分页，旧 runtime 的 404 降级为完整快照后本地分页。


| 能力 | 入口与使用点 | 适用边界及共享方式 |
| --- | --- | --- |
| 总览 Agent 多选 | [DashboardFilter.ToolChannelSelect](../packages/dashboard/src/components/DashboardFilter.tsx)，总览及 ShareActivityModal 使用 | 空数组表示全部。Desktop 总览/托盘使用自己的 DashboardFilter；共享分享弹窗使用 Dashboard 版本 |
| 热力图 Agent 多选 | [PlatformFilterSelect](../packages/dashboard/src/components/PlatformFilterSelect.tsx)，ActivityHeatmap 使用 | `value` 是具体选中集合；`[]` 表示无结果，全选可由 `applyPlatformFilterChange` 折叠成 `null`。与总览 Agent 不可混用空选语义 |
| 用量日期范围 | [DashboardDateRangePicker](../packages/dashboard/src/components/DashboardDateRangePicker.tsx)，DashboardFilter 使用 | 绑定统计时区、DashboardDateRange 和回看天数限制；Desktop 直接 re-export |
| 时间范围快捷选择 | [DashboardTimeRangeControl](../packages/dashboard/src/components/DashboardTimeRangeControl.tsx)，DashboardFilter 与 SessionsPage 使用 | “今天 / 1D / 7D / 30D / 90D / 自定义”的共享外观、选中态与日期选择器；调用者负责查询范围。会话页显式选择 1D 后复用滚动时间 hook，切换时间保留列表筛选并重置页码；两端直接引用同一组件，Desktop 登记 CSS `@source` |
| 初次加载/范围刷新 | [DashboardLoadingSkeleton](../packages/dashboard/src/components/DashboardLoadingSkeleton.tsx)、[DashboardRangeSyncOverlay](../packages/dashboard/src/components/DashboardRangeSyncOverlay.tsx)，DashboardPage 使用 | 骨架匹配当前总览槽位；刷新遮罩需要定位父级。两端有独立副本，Desktop 另用于托盘 |
| 来源占比条 | [SourceProgress](../packages/dashboard/src/components/SourceProgress.tsx)，AgentShareCard 使用 | 来源品牌色及百分比语义，两端各有副本 |
| 会话预览与归属 | [SessionActivityPanel](../packages/dashboard/src/components/SessionActivityPanel.tsx)，DashboardPage 使用 | 总览预览最近 6 条和用量归属；“查看全部”及关联入口带入当前范围，进入会话页；Desktop 直接 re-export |
| 会话分页 | [SessionPagination](../packages/dashboard/src/components/SessionPagination.tsx)，SessionBrowser 使用 | 基于 HeroUI Pagination 组合页码、首末页、省略号、上一/下一页，提供跳页与 12/24/48 每页条数；页码、条数保存在 URL，筛选/条数改变重置页码，服务端夹回越界页后 replace URL。摘要区明确计数为主会话，匹配总会话数包含子项；翻页滚到结果顶部但保留操作焦点。加载反馈与失败反馈分开，失败保留旧结果并允许返回其他页。Desktop 直接引用并登记 CSS `@source` |
| 会话浏览页 | [SessionsPage](../packages/dashboard/src/pages/SessionsPage.tsx)，两端 `/sessions` 路由与 FilterChromeActions 接入 | 共用 SessionBrowser、FilterMenu 与会话行；搜索、Agent/项目筛选、排序字段及方向、页码、每页条数及关联条件保存在 URL，优先由服务端在完整匹配集合上筛选排序后分页。筛选区集中放置搜索、Agent、项目及模型，显示选项与导出/审计操作分组；摘要区显示完整匹配集合的主会话数，仅存在关联项时补充含关联总数。宽布局表头支持最近活动、Token、费用排序，Token 与费用各占独立列，数值使用清晰字号与对比度；有列头的宽屏主行及关联子行省去重复 Token 后缀，无列头的预览和窄屏继续保留单位。列宽按容器比例分配，避免多余宽度全部落入会话名称列。Token 占比在展开详情的服务/账号信息行展示，统计范围及占比说明收进该值的 Tooltip；窄布局将排序字段和方向合并为同一菜单，保留四个字段的双向排序；宽布局通过列头排序，并在显示选项中保留任务时长双向排序入口。表头用 HeroUI Button 组合 `Table.SortableColumnHeader`，并显式复用 Table 排序标签及方向图标样式；完整 Table.Header 依赖表格集合，不适用于当前按根会话分组的列表。页头以时间控件表达范围，不重复统计范围/用量说明，不提供局部刷新及主题按钮；有总览来源限制时保留范围提示。总览日期（含滚动时间边界）和来源范围单独保留，清除列表筛选不会扩大关联范围。返回总览复用 dashboard-return-state；Desktop 路由直接引用共享页面并登记 CSS `@source`；模型筛选和日期/项目分组写入 URL；12 条按根会话分页；关联展开箭头及数量位于主行，与详情按钮独立，提供展开状态及目标关联，折叠态不增加行高，展开后以浅 accent 底、节点标记和细竖线表达归属，展开控件、来源图标与名称同步缩进，其他列与主表对齐；“关联会话”标题与模型控件相邻排列，展开态与中性悬停反馈区分；保留子项模型筛选及其选择状态，多模型使用紧凑菜单，单模型显示静态名称。可信会话标题优先，缺失时依次使用已有元数据中的代理昵称、非默认角色及本地化的未命名提示；无真实标题时以独立辅助行显示带 ID 标识的等宽短 ID；角色有明确标签，辅助文字不小于 12px，窄屏优先名称和完整短 ID，角色仍可从读屏、完整提示及详情访问；深层节点的数字可另起一行，项目、时间与数字在窄屏进入节点内容内侧，避开树线和展开标记；宽屏继续与主表列对齐。展开按钮对齐图标所在的身份区域，不按整条多行记录居中，不遮挡项目与时间。分页摘要在已有 metadata 缓存构建处携带可选身份字段，旧 runtime 回退已有 insights 或原名称/ID，不逐条加载详情，也不从正文推导名称；项目名仅对明确路径/网址及超长名称做显示缩短，保留完整原值提示、读屏文本及详情入口，不改写筛选、分组或导出键；点击会话打开 HeroUI Modal，保留通知精确定位与旧模型/归属信息；详情使用 SessionDetailDialog 与 SessionUsageBreakdown，SessionInsightDetails 保留兼容导出和 ContextAuditButton；Desktop index.css 登记共享组件 `@source`；所有 Select 仍走 FilterMenu |
| 会话详情 | [SessionDetailDialog](../packages/dashboard/src/components/SessionDetailDialog.tsx)、[SessionUsageBreakdown](../packages/dashboard/src/components/SessionUsageBreakdown.tsx)，由 SessionActivityPanel 打开；[session-detail](../packages/dashboard/src/lib/session-detail.ts) 统一展示口径 | 单一标题、固定四项操作及正文滚动区。默认“仅本会话”，存在后代时可切换“含关联会话”，联动总量、Token 构成和模型费用；按本会话/子代理/分叉/其他关联拆分，单成员直接展示身份与用量，多成员保留折叠；无后代省略不可切换的范围入口，旧 runtime 降级摘要保留。列表筛选不二次裁剪成员。普通详情以一行“所选期间用量”显示 runtime 实际范围；通知定位仍为已采集历史。期间帮助只解释当前入口对应范围与统计时区，中文使用“北京时间（UTC+8）”；半小时归集规则和隐私说明保留在正文末尾默认收起的“统计与隐私说明”，指标证据限制归入活动帮助。范围切换限定在“用量与费用”区域，包含摘要、归属和模型表；性能和活动归入独立“本会话活动”区域且直接展示，不在两项标题重复本会话标识，分别保留样本和覆盖；少量会话信息直接展示，不增加折叠步骤；任务时长去掉“已记录计时”后缀，估算标识保留，来源与含义从相邻帮助查看；关联会话名称承接原历史链接；宽屏按名称、角色、Token、费用四列分配空间，窄屏角色置于名称下方，成员之间使用轻分隔线，不增加重复操作行。范围帮助只保留已识别后代包含子代理和分叉的边界；费用短说明、响应样本和活动覆盖从相邻 HelpPopover 查看，每个模型通过可用键盘操作、带展开状态及目标关联的按钮就地展开用量与计价明细，默认收起；不再显示表下统一计算依据及技术匹配信息。分项用量、实际应用单价与可确认费用由 Core 同一请求级算式提供，不同档位/输入阈值/缓存 TTL 的费率保持分组；来源上报总额与旧 runtime 无法确认的分项费用显示未知，保留参考单价及简短说明。Token 构成与模型费用共用 HeroUI Table，单模型且与整体一致时无重复合计，多模型或未归属差额时表尾显示普通背景合计；standard/unknown 不生成标签或副行。逐模型展示总 Token、输入/缓存/输出/推理、已知请求和费用；无模型明细时以紧凑缺失状态替代空表，摘要保留已知总量/费用/小计；非空的 unknown 模型仍显示为模型行。未知分类、未分类 Token 和未分配费用从帮助查看，窄屏只在有数据的表格区域横向滚动。Token 与费用格式遵循本文件「用量数字与模型单价」章节；极小非零、未知、零、已知小计分开；无详情专用精确/简洁模式，原始精度沿用列表 CSV 导出。用户明确要求删除会话 ID、项目路径及恢复命令原文和重复复制入口；账号、时间、计费和代理关系保留。复制成功使用应用 Toast（约 2.5 秒），不占标题区；动作错误保留附近反馈，目录失败可重试。旧 runtime 继续回退本会话明细和可用复制能力。Desktop 经 SessionActivityPanel 共用，index.css 登记两个组件的 `@source` |
| 上下文审计与兼容入口 | [SessionInsightDetails](../packages/dashboard/src/components/SessionInsightDetails.tsx) | SessionInsightDetails 兼容导出新详情弹窗；ContextAuditButton 保留只读上下文来源审计。列表 CSV 导出仍由 SessionActivityPanel 提供，不与详情 JSON 复制混用；Desktop 共用 |
| 会话本机操作 | [SessionDetailDialog](../packages/dashboard/src/components/SessionDetailDialog.tsx) | 顶部固定“继续会话 / 打开文件夹 / 复制恢复命令 / 复制项目路径”，复制能力独立于本机启动能力。复制项目路径时，Windows 的 `\\?\C:\…` 转为 `C:\…`、`\\?\UNC\server\share\…` 转为 `\\server\share\…`，便于粘贴到资源管理器；其他路径保持原样，本机动作仍使用运行端的原始目录。两个本机动作通过 `/functions/tud-session-actions` 请求运行端从已采集记录解析的操作；执行中禁用两个动作按钮，固定操作区反馈启动结果及错误。不可用操作保留禁用入口并分别说明原因。动作 API 返回的恢复命令优先；显式 null 不回退到旧命令。旧/远程 API 保留复制回退，目录读取失败可重试。PI 使用核实的原始 JSONL，ZCode 按会话 ID 查询数据库目录；Antigravity CLI 使用 `agy --conversation <所选 ID>`，仅从已采集 CLI 原文件所属的 `cache/last_conversations.json` 精确匹配项目目录，目录未知时保留复制命令；不把桌面版 / IDE 记录直接当作 CLI 会话。DeepSeek Harness 需要兼容恢复的 profile，未适配时说明限制。Windows 使用系统默认终端宿主与 PowerShell，macOS 使用系统 Terminal，Linux 使用 x-terminal-emulator；不读取或切换用户终端 profile。Desktop 共用组件与 IPC transport |
| 趋势浏览 | [UsageTrendExplorer](../packages/dashboard/src/components/UsageTrendExplorer.tsx)，DashboardPage 使用 | 用量时间轴、动态粒度和费用分组；本地模式的两张图共同占满总览一整行，宽屏各占半宽、窄屏纵向排列。每张图的展开按钮打开 HeroUI Modal，复用当前数据、指标与分组状态，保留控件、Tooltip、图例和计价说明；Desktop 直接 re-export，并在 `index.css` 登记共享组件的 `@source` |
| 价格筛选与比较 | [PricingTools](../packages/dashboard/src/components/PricingTools.tsx)、[PricingMoreFilters](../packages/dashboard/src/components/PricingMoreFilters.tsx)、[PricingComparison](../packages/dashboard/src/components/PricingComparison.tsx) | 厂商、上下文、日期、汇率、渠道及估算场景属于价格业务；共享 PricingPage 的 loadCatalog 读取 runtime 生效表，Desktop 注入 IPC 价格与用量读取；runtime 不可用时回退内置目录；两端价格路由共用 parsePricingSearch，models 参数携带来源/模型集合，按保守身份解析筛选同一模型的渠道分组，保留清除入口及未匹配提示 |
| 用量分享 | [ShareActivityModal](../packages/dashboard/src/components/ShareActivityModal.tsx)、[ShareBackgroundPicker](../packages/dashboard/src/components/ShareBackgroundPicker.tsx)、[ShareCardCarousel](../packages/dashboard/src/components/ShareCardCarousel.tsx)、[ShareCardActions](../packages/dashboard/src/components/ShareCardActions.tsx) | 绑定分享快照、背景库和海报导出；Desktop 分享弹窗 re-export Dashboard。组件不作为任意轮播或上传器 |

热力图局部入口明确标注「热力图来源」，菜单解释仅影响本图；空选动作称为「取消全选」，保留已有无结果语义。圆环图隐藏分项后，以「显示项合计」说明分母并提供「恢复全部」。Token 数量格式保存后通过 i18n 的展示偏好事件更新已挂载组件，不刷新文档、不重置弹层和页面状态；两端独立存储入口均通知同一共享 i18n 实例，跨窗口 storage 变化也触发更新。

当前没有统一的全页面 EmptyState；无数据、无匹配结果、读取失败由对应业务表达。新增页面先复用合适的 HeroUI 原件或现有业务表达，确有重复契约时再抽取。

三页的补充交互约定：

- 会话项目筛选通过 `Autocomplete` 与 `FilterAutocompletePopover` 提供可见搜索、无匹配结果、全部项目和清除项目筛选；计数与 URL 筛选键保持原始项目身份。关闭菜单或移除页内条件后恢复触发按钮焦点；菜单内清除项目后保持打开，焦点回到搜索框。关联详情标题、读取占位和可访问名称复用 `sessionDisplayIdentity` 的标题、昵称、角色及未命名顺序；旧运行端缺少身份时保留进入时的名称，不重新暴露完整会话 ID。
- 价格比较的复选框持续可见；比较表在自身纵横滚动区内固定模型表头和指标列。更多筛选即时应用并保持外层打开，自定义日期确认/取消返回筛选层，完成或外层 Escape 关闭。
- 成就的周期可达成性依据统计日期和当前采集的活跃日；今天尚未结束时允许当天继续达成，历史漏采可在补采后更新。当前记录下已无法完成的周期不进入首页推荐，历史记录不删除；详情明确已结束或本期无法达成，进度仍可查看。
- 上下文审计保留已发现内容估算与实际加载量未知的区别。异常正文显示跳过文件/目录及读取/解析异常数量，位置、原因和影响按需展开；未扫描目录内的文件数未知。诊断最多展示前 100 项，汇总仍计入其余已记录问题；旧运行端没有明细时明确提示。路径为扫描根相对路径，多个用户根以序号区分，不返回内容、密钥或错误原文。失败可在弹窗内重试。

存量 `RankFilter`、`RankModelCascadeSelect` 和 `KeyFilterSelect` 在当前两个 UI 根中未找到页面接入点。它们的菜单外壳也遵守公共约束，但不能作为已验收页面或优先复用的业务入口；接入时重新核对调用、键盘和视觉行为。Desktop 的 PlatformFilterSelect 当前也未找到使用点。

## 筛选与选项菜单

### 选择入口

从当前端的 `components/FilterMenu` 导入，保持原 HeroUI 宿主及选项结构：

| 原宿主 | 公共浮层 | 内容 |
| --- | --- | --- |
| `Select` | `FilterSelectPopover` | `ListBox` 与单选/多选项；保留 `textValue` 和 selection props |
| `Autocomplete` | `FilterAutocompletePopover` | `Autocomplete.Filter`、搜索框与 `ListBox`；搜索和底部动作不随列表滚动 |
| `Popover` 自定义列表 | `FilterMenuPopover` | `header` 放标题、搜索、全选/清空，`children` 放选项，`footer` 放固定动作 |

```tsx
import { Label, ListBox, Select } from '@heroui/react';
import { FilterSelectPopover } from './FilterMenu';

<Select aria-label="Project" value={project} onChange={onProjectChange}>
  <Label className="sr-only">Project</Label>
  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
  <FilterSelectPopover className="w-64">
    <ListBox aria-label="Project">
      {projects.map(item => <ListBox.Item key={item.id} id={item.id}
        textValue={item.name}>{item.name}<ListBox.ItemIndicator /></ListBox.Item>)}
    </ListBox>
  </FilterSelectPopover>
</Select>
```

示例只说明组合方式；实际页面使用 i18n 文案。真实例子见 PricingTools、SessionActivityPanel 和 PlatformFilterSelect。

### 公共约束

- 浮层默认最大高度为 `FILTER_MENU_MAX_HEIGHT = 320`，由 HeroUI 的 `maxHeight` 接口结合可用视口定位；窗口更矮时自动缩小。调用者不用重复填写高度。
- 超长列表只在选项区域滚动，沿用主题滚动条并包含 overscroll；避免嵌套多个纵向滚动区。短菜单按内容自然收缩。
- 宽度可以按内容设置，公共入口默认限制在视口内。长名称按业务选择截断、换行或完整名称提示，不能挤掉选中标记与计数。
- 紧凑 Select / Autocomplete 不只缩小 Trigger 高度：固定高度时配套垂直居中及内边距，内部 Value 显式设置预期字号和行高（现役 28/32/36px 紧凑筛选为 12px / 16px）。不能依靠 Trigger 的字号覆盖 Value 自身样式。验收检查 Value 的可见高度容纳完整行高，带图标、长名称及窄屏时不发生纵向裁切；水平截断仍按原业务规则保留。
- 搜索、全选、清除及底部动作保持可达；关闭、Escape、键盘导航和焦点恢复沿用原宿主契约。公共层不改变选中后是否关闭。
- 公共层不编码业务值，不把空数组、`all` 或 `null` 解释为统一含义；不承担筛选查询和持久化。
- 不在调用者通过 `style.maxHeight`、`!max-h-*` 或 overflow 类覆盖公共尺寸/滚动约束。特殊需求先评估扩展公共组件，再按总则记录例外。
- 级联模型菜单保留两个独立滚动列及固定搜索头，通过 `FilterMenuPopover` 的 `bodyClassName` 布局；其厂商/模型状态仍由业务组件管理。
- 浮层层级：React Aria 把触发器锚定的菜单和 Tooltip 固定为内联 `z-index: 100000`，两端 `index.css` 让 Modal 使用同一层级（按挂载顺序，即打开顺序决定前后），Toast 位于最上层。Modal 内打开的菜单仍在 Modal 之上；从 Toast 动作等顶层提示打开 Modal 时，先用 `lib/overlay-dismiss` 的 `dismissTransientOverlays` 关闭页面级菜单。

### 范围与例外

日期编辑器、计算器、解释性 Popover、原生系统窗口有各自布局合同，不套用列表菜单的 320px 上限。安装方式菜单和模型 ID 复制列表属于动作入口，按各自语义维护。

当前允许直接使用 HeroUI Select.Popover 的页面例外仅有 Desktop [SettingsPanel](../apps/desktop/src/renderer/components/SettingsPanel.tsx) 的 macOS 托盘模式设置（Token、费用、两者、订阅剩余额度，共四项）与 [QuotaSettings](../apps/desktop/src/renderer/components/QuotaSettings.tsx) 的配额预测模式设置（三项）：均为固定少量、异步持久化的设置控件，保留原有设置行为。菜单栏额度模式的归一化与摘要有单元测试，macOS 原生菜单栏显示仍需在对应系统验收。新增例外需要同时更新这里的理由和对应检查范围。

Desktop「订阅」设置中的服务故障/恢复提醒默认开启，已有明确关闭的偏好保持关闭。额度面板快捷键默认关闭，开关名称为「打开额度面板」；初始组合 Windows/Linux 为 Ctrl+Shift+U，macOS 为 Cmd+Shift+U。左侧为启用勾选项，右侧为紧凑的键位输入框。焦点进入快捷键设置行时显示保存按钮和说明，有未保存修改或需重试时仍可直接保存。输入框支持直接按键录入，也可手动输入组合键名称。全选、粘贴和光标移动等文本操作继续可用。保存或开启时校验格式并用系统注册结果检测冲突；编辑中不提前报错，错误关联输入框，保留草稿和原设置。替换时先预约新组合，持久化成功后才释放旧组合；失败保留旧注册。关闭后仍保留组合，启动时无法恢复注册会就地提示，关闭与退出只释放本功能持有的快捷键。测试通知入口只在 Vite 开发模式显示，生产 preview 与安装包隐藏且不注册测试 IPC；开发反馈仍分别显示系统已接收、已请求但未确认显示、发送失败，不能把请求成功写成用户已看到。通知点击复用额度浮窗，未提供浮窗的平台进入主窗口。首次服务观察、筛选变化、过期和未知状态不触发故障/恢复提醒；多账号按厂商合并查询与通知。

总览专项验收：两端构建后运行 `corepack pnpm test:dashboard-ui [全新输出目录]`。它复用 Electron 界面测试驱动，以合成数据经真实 Core API / IPC 验证费用原始精度、单位切换不刷新、整行明细键盘与焦点、长列表浮层边界和滚动、完整项目名、分母说明、宽窄屏主指标；生成两端截图，仍需查看实际画面。

## 验收与持续约束

### 额度、总览与分享

- 双端额度卡继续共用 `packages/dashboard/src/components/QuotaUsageCard.tsx`；重点窗口选择只改变显示顺序，默认自动选择有效且最紧张的窗口。偏好以卡片 ID 隔离；缺失或过期选择回退当前读数，不屏蔽其他窗口及风险。正常服务列表与来源时间由原生 details 按需展开，异常保持可见。`QuotaRecoveryActions.tsx` 提供只读登录指引与复制命令；有自定义目录时显示目录和指引，不拼接未转义的终端命令。
- Desktop 通知经 `shared/quota-navigation.ts` 保存待处理目标，renderer 订阅后读取、定位并确认。额度窗口目标必须校验匿名账号引用，同一 profile 换号不定位到新账号。服务状态通知只定位服务。托盘固定显示额度摘要，忽略 `tray-panel.json` 中旧版「摘要／完整」偏好。卡片详情打开时面板扩大高度，失焦时隐藏，Esc 先关闭详情。
- 两端总览始终展示完整分析，不提供快速／完整模式切换，也不读取旧版 `tud.dashboardQuickView` 偏好。保留全部指标、会话统计、额度、热力图、洞察、会话预览、分析图表与原筛选；`DashboardOverviewCard` 的独立副本一起维护。
- 分享入口共用 `ShareActivityModalContent`、`ShareCardCarousel`、`SharePosterArtwork` 与 `ShareCardActions`。`lib/share-presentation.ts` 集中定义画幅尺寸、累计 Token 和费用证据语义；预览与冻结的导出请求使用同一参数。详细卡片默认 2:3；主指标版式支持 Token／费用，其他画幅为 1:1、4:5、9:16。累计线只使用实际日期记录，单点不伪造趋势。`hooks/useShareReport.ts` 按分享期间与 Agent 筛选在本次会话内缓存同份报表的费用、Token、模型和累计日期，不单独刷新费用。缺失／全未知显示“—”，部分计价标注范围，已知零仍显示零；旧 runtime 无报表时保留原用量快照且费用未知，配文共用该口径。新共用组件样式登记 Desktop 的 `@source`。
- `LocalBackupPanel.tsx` 由双端直接共用。预览日期取实际用量桶时间，来源列表有边界，配置起点不视为覆盖范围。保护恢复默认勾选，服务端成功保存保护文件才开始新目录恢复；目标冲突时仍展示保护路径。旧 API 和 v1 文件可继续使用。所有按钮由同步互斥入口防止重复提交。
- 双端数据设置直接复用 [UsageRecoveryPanel](../packages/dashboard/src/components/UsageRecoveryPanel.tsx)。选择 `.jsonl` 后显式预览，显示新增用量、日期与跳过结果；只有有效预览才能确认。文件变更清除旧预览，数据冲突时保留文件以便重新预览。Token 遵守现有单位设置；Electron 登记该组件的 CSS `@source`。
- Codex 可用重置次数沿用现有额度卡摘要；只有打开共用详情才展开已知到期时间。未取得明细、只取得部分明细或读数陈旧时保留次数，提示缺失时间，不把普通额度窗口的重置时间当作资格到期时间。

1. 对照改动前检查选项、计数、单/多选、全部/空选、搜索、清除、选中后应用/关闭、分页是否保留。
2. 用内置浏览器检查真实页面：长列表、长名称、窗口变矮、选中项在末尾、鼠标滚动与键盘 End/Arrow/Enter/Escape、焦点返回触发器。确认最后一项可见可选，背景页面不被列表滚动带走。
3. 有固定头尾时，滚到底检查搜索/动作仍可见；嵌套 Modal 的菜单要单独检查。级联列、Desktop 托盘与原生窗口按实际可用环境补验，未实测必须说明。
4. 执行相关类型检查和测试。菜单公共入口策略由 [ui-menu-contracts.test.ts](../packages/dashboard/src/lib/ui-menu-contracts.test.ts) 检查两个 renderer 的直接 Select/Autocomplete 浮层用法（含命名导入别名）；它随 Dashboard 现有测试进入 CI。该检查不能代替视觉、滚动和键盘验收，自定义 Popover 的语义及复用由代码审查核对。
5. 按本节信息呈现矩阵验收默认界面和按需展开后的界面。单/多模型、完整/部分归属、standard/非默认档位、说明隐藏与打开、价格筛选/清除/未匹配都要检查；不能只测“字段存在”。[session-detail-presentation.test.ts](../packages/dashboard/src/lib/session-detail-presentation.test.ts) 和 [pricing-selection.test.ts](../packages/dashboard/src/lib/pricing-selection.test.ts) 随 Dashboard 测试进入三平台 CI；两端构建后运行 `corepack pnpm test:session-detail-ui`，由 [session-detail-smoke.mjs](../apps/desktop/scripts/session-detail-smoke.mjs) 实测 DOM、键盘、Popover 和窄屏。Windows CI 自动执行同一界面脚本。查看截图确认表头圆角、合计行与信息层级；自动断言不能替代视觉判断。
6. 调整紧凑筛选尺寸后，两端构建并运行 `corepack pnpm test:session-pagination-ui`；[session-pagination-smoke.mjs](../apps/desktop/scripts/session-pagination-smoke.mjs) 同时检查会话列表与总览、分享、价格页的文本可见高度、长模型名称、Agent 图标、厂商选择/清除及焦点返回，覆盖 HTTP / IPC 与宽窄布局。核对生成的截图，不能仅凭字号类名断言文字完整。
7. 调整性能分析、额度历史、用户价格或本地备份流程后，构建并运行 `corepack pnpm test:keeper-insights-ui`；[keeper-insights-smoke.mjs](../apps/desktop/scripts/keeper-insights-smoke.mjs) 使用独立 Electron 窗口、真实 Core API 与 preload IPC，验证筛选/会话跳转、价格校验/保存/恢复/焦点、额度周期与曲线日期、备份下载/文件校验/目标冲突/真实恢复，以及 Token 单位和四语言。额度来源与原生偏好为合成 fixture；人工核对输出截图，系统文件选择器及真实账号另行验收。
8. 调整额度关注、提醒定位、托盘摘要、总览展示或分享编辑后，构建并运行 `corepack pnpm test:island-ux-ui`。独立合成数据覆盖 HTTP/IPC 保存失败与重试后的焦点、正常服务折叠、旧快速查看偏好不隐藏完整分析且无模式切换、分享三版式四画幅内容边界及 PNG 尺寸、快照稳定、窄屏与四语言，以及 Windows 托盘的通知目标、换号撤销、固定摘要、忽略旧偏好、打开主窗口和 Esc。通知定位使用合成目标。

```bash
pnpm --filter quotern-dashboard exec tsc --noEmit
pnpm --filter quotern-desktop typecheck
pnpm --filter quotern-dashboard test
git diff --check
```

文档路径和组件默认行为应在同一变更中核对。当前先维护本项目的规范入口；反复出现且流程稳定的开发/验收操作，再考虑另建引用本文的 Skill。
