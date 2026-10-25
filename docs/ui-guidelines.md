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

现有入口不适用时先扩展或组合公共能力；经典 DOM、主进程等运行环境不能直接导入 renderer 模块时，说明适配边界并保持同一展示契约，不能各自另定规则。审查新增格式化函数及其调用点时，同步核对这些入口与两端副本。

验收至少覆盖：切换本地化/K/M/B/T 后相关展示实际更新；零、极小非零、普通金额、未知值和部分计价；同一数据跨组件与两端同格式；模型单价、报价基准和 USD/CNY 切换保留；CSV/API 数值精度不受展示舍入影响。文档更新本身不能代替代码检查或真实页面验收。

## 信息呈现与默认界面

1. **先确定用户要判断或执行什么。** 正文优先展示结果和动作，不按 DTO 字段顺序铺开页面。新增一行文字、标签或说明时，确认它是否改变用户当前判断；默认界面没有这种价值的内容进入按需入口。
2. **默认配置不制造标签。** `standard`、`unknown` 等无区分价值的服务档位不显示，也不生成空白副行；非默认档位才补充标识。这条针对配置/身份标签，不适用于记录到的零值；未知测量值保持未知，不伪装成零。
3. **汇总必须有新增价值。** 单模型与整体用量/费用一致时省略合计行；多模型或存在未归属差额时保留合计。主汇总使用一个视觉重点，表内合计与分项对齐，用普通背景和轻分隔线，不叠加第二块强调卡片或整行重底色。
4. **说明放在问题发生的位置，默认收起。** 指标定义、统计口径、样本与覆盖、缺失字段清单、计价匹配规则等，使用相邻、可点击且支持键盘的帮助浮层。长说明不常驻正文，不用悬停 Tooltip 承载长文或链接，也不在折叠标题重复完整摘要。实际失败、待处理问题、未知/已知小计和影响判断的异常保留简短状态，详细原因按需展开。
5. **复用业务目的地。** 参考价格在新标签页进入价格页，保留原页面与弹窗，携带明确、可清除的模型筛选；Desktop 使用带原有 IPC 数据连接的独立价格窗口；不能把多个模型拼成模糊搜索，不能在匹配失败时静默退回全部目录。参考价和会话费用依据分别表达，不把当前目录当作历史账单。实现标识如 `overlay`、`prefix-strip` 只在主动查看依据时出现。
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
| 单套 / 多套价格证据 | 费用帮助内，单模型至多一套证据直接展示；其他保留分组折叠 | 账单提示只表达一次，匹配规则、假设及未分配金额保留 |

## 组件清单

以下路径以仓库根为起点。清单覆盖现有主要 UI 入口，不代表所有业务组件都已通用化，也不代表独立副本逐字一致。

### 公共基础与应用入口

| 能力 | Dashboard 入口与使用点 | 适用边界 | Desktop 方式 |
| --- | --- | --- | --- |
| 页面布局 | [AppShell](../packages/dashboard/src/components/AppShell.tsx)，由 `routes/__root.tsx` 注册 | 根路由的宽度、滚动容器、Provider 与全局弹层；页面通过 Outlet 接入 | 独立 `AppShell`，保留窗口/托盘差异 |
| 筛选菜单浮层 | [FilterMenu](../packages/dashboard/src/components/FilterMenu.tsx)，价格、会话、总览 Agent、趋势、分享范围等使用 | 单选、多选、可搜索列表和自定义选项列表的公共尺寸/滚动外壳；详见下一节 | [本地 re-export](../apps/desktop/src/renderer/components/FilterMenu.tsx)，共用同一实现 |
| 持续状态提示 | [StatusBanner](../packages/dashboard/src/components/StatusBanner.tsx)，DashboardPage、PricingPage、SettingsPanel 使用 | `info/warn/error/success` 状态与说明；操作完成的短暂反馈使用 Toast | 同名独立副本 |
| 设置帮助说明 | 浏览器设置维持现有说明布局 | 标题旁的独立信息按钮，悬停显示入口名称，点击打开可阅读、可含链接的说明浮层；触发器不放入 Checkbox / Label 的点击区域，关闭与焦点恢复沿用 HeroUI Popover。规则与背景可按需查看，实际状态、错误和操作反馈仍直接显示 | [SettingsHelpPopover](../apps/desktop/src/renderer/components/SettingsHelpPopover.tsx)，用于 QuotaSettings 的提醒与分析、周额度参考节奏、订阅通道，以及 SettingsPanel 的 Token 数量格式和 PetSettingsCard 的导入宠物；解释性浮层不套用 FilterMenu |
| 应用 Toast 队列 | [AppToastContext](../packages/dashboard/src/components/AppToastContext.tsx)，AppShell 提供队列 | `useAppToastQueue` 必须位于 Provider 内；局部队列仍有合法使用场景，如价格页比较数量提示 | 独立 Context 和 `AppToastProvider`，后者避让窗口拖拽区 |
| 按需帮助 | [HelpPopover](../packages/dashboard/src/components/HelpPopover.tsx)，SessionDetailDialog、SessionUsageBreakdown、PricingPage 使用 | 标题旁独立图标，Tooltip 只提示入口名称，点击 Popover 阅读定义、依据或覆盖信息；共享壳负责视口边界、焦点和 Escape，不使用筛选菜单外壳。现有 SettingsHelpPopover 是 Desktop 设置专用，CostExplanationLabel 绑定费用业务，均不适合直接承载共享会话指标 | 直接引用 Dashboard 实现，并在 index.css 登记 `@source` |
| 图表基础 | [ChartPrimitives](../packages/dashboard/src/components/ChartPrimitives.tsx)，TokenUsageTrendCard、UsageDistributionCard 等使用 | Recharts 容器、主题、Tooltip/Legend；数据转换与指标含义留在业务图表中 | 同名独立副本 |
| Agent 来源图标 | [ProviderIcon](../packages/dashboard/src/components/ProviderIcon.tsx)，会话、项目和 Agent 选择器使用 | Agent/采集来源标识及 fallback | 同名文件，分别核对资源与平台能力 |
| 模型厂商图标 | [ModelProviderIcon](../packages/dashboard/src/components/ModelProviderIcon.tsx)，价格列表与比较使用 | 模型厂商及渠道标识；不要替代 Agent 来源图标 | 随共享价格组件引用 Dashboard 源文件 |
| 订阅品牌图标 | [SubscriptionBrandIcon](../packages/dashboard/src/components/SubscriptionBrandIcon.tsx)，QuotaUsageCard 使用 | 订阅品牌；与 Agent/模型厂商有不同语义与资源集合 | 独立实现，Desktop 支持的品牌/资源更多 |
| 外观偏好 | [ThemePreferenceControl](../packages/dashboard/src/components/ThemePreferenceControl.tsx)，SettingsPanel 的「应用」中紧随语言设置 | 明确选择跟随系统、浅色、深色，立即应用并保存；位于运行配置之前，不依赖配置读取成功。FilterChromeActions 不再提供主题按钮，所有浏览器面板均保留设置入口；存量 ThemeToggle 仅供旧页面使用 | Desktop SettingsPanel 直接引用同一控件，由各端独立主题 hook 提供状态与保存，Desktop 保留主进程系统外观广播 |
| 关于与仓库链接 | [AboutContent](../packages/dashboard/src/components/AboutContent.tsx)，设置「关于」与 AboutModal 使用 | GitHub 仓库链接位于版本信息下方，保留反馈和支持的 Agent 信息；仪表盘操作区不再单独展示仓库按钮 | 同名独立副本；仓库链接经原生 openExternal 打开 |
| 应用更新 | 浏览器端不提供桌面更新操作 | Desktop 构建策略决定自动或手动更新，不由运行时环境变量控制 | [AutoUpdateAction](../apps/desktop/src/renderer/components/AutoUpdateAction.tsx) 与 [SettingsPanel](../apps/desktop/src/renderer/components/SettingsPanel.tsx) 复用 shared/auto-update 的操作语义；macOS ad-hoc 显示「手动更新」/「前往下载页」及说明，不声称已发现新版本，不显示检查/下载/安装进度；signed 和 Windows 安装版保留自动更新，Windows portable 保留新版本提示与下载页入口 |
| 语言偏好 | [LanguagePreferenceControl](../packages/dashboard/src/components/LanguagePreferenceControl.tsx)，SettingsPanel 使用 | 四种语言单选，系统语言对应项标记“自动”并保存 `system`；`systemLocale` 独立于当前界面语言 | Desktop SettingsPanel 直接引用，系统语言由主进程提供 |
| 桌面宠物设置与原生托盘入口 | 浏览器端不提供 | 标题行提供唯一的「启用」开关；其下的通用区提供唯一的「大小」控件，修改当前已应用宠物系统的尺寸，切换预览不改变该控件的目标，两套系统仍各自保存尺寸；角色卡片仅切换预览与编辑对象，详情预览当前宠物时显示不可点击的「✓ 当前宠物」状态标记，预览其他宠物时通过「设为当前宠物」按钮明确应用；应用成功后同步更新当前状态，不额外显示全局「已设为当前宠物」成功提示。卡片边框表示预览对象，文字标记与标题状态显示当前宠物。两套宠物保留独立配置与生命周期，应用其他宠物时保留总开关状态，启用时互斥；关闭后保留当前系统、角色与设置，重新开启（含重启应用后）恢复已应用宠物，不跟随最后预览对象。导入成功仅预览新角色。托盘通用宠物开关恢复当前宠物，单独大肥鱼入口仍可直接启停大肥鱼。原生系统菜单使用 Electron Menu，不套用 FilterMenu；名称固定为「大肥鱼」，单击复选项切换唯一大肥鱼及后台任务的开关，历史网页显示位保留 | Windows 的设置窗口按「宠物 / 订阅 / 应用 / 关于」排列；首次打开默认展示「宠物」，后续打开保留已选页签，宠物右键设置入口直接定位「宠物」。[PetSettingsCard](../apps/desktop/src/renderer/components/PetSettingsCard.tsx) 由独立「宠物」页签承载，在同一卡片中展示内置/导入角色与大肥鱼，后者嵌入 [DshPetSettingsCard](../apps/desktop/src/renderer/components/DshPetSettingsCard.tsx)；切换编辑对象保留表单草稿。各角色详情统一以角色名、「预览」标签及当前状态标记或应用按钮组成标题行，不重复展示通用介绍文案。大肥鱼的普通启停状态由顶部统一展示，详情只补充启动中、运行错误与重试入口。大肥鱼角色卡片名称固定显示「大肥鱼」，不显示 dsh-pet 副标题，保留当前宠物标记。大肥鱼直接展示预览与设置，不显示「手动控制／宠物设置」分组标题；预览区下方与其他角色一致，按「平静、思考、多任务、连续使用、庆祝、休息」排列，宽屏单行六项、窄屏两行三项，依次播放「用鲸鱼尾巴拍打地面、舞狮头、原地左转奔跑、堆雪人、点击回应-开心跃动、哈欠连天」。打开大肥鱼预览时立即自动播放默认「平静」动作，系统减少动态效果偏好不抑制该预览；点击状态立即播放对应动作预览，再次点击同一状态从头重播；关闭大肥鱼时仍可预览。不显示原生视频控制条，也不提供额外的播放或查看额度按钮，其余设置组保留折叠。仅编辑单实例，不提供多开或目标选择；提供小、中、大三档，宽度分别为 160/204/264 px，角色可见高度约 71/91/118 px，与 Clawd 相近；不提供角落、水平偏移或垂直偏移数字项，也没有聊天入口。[TrayPopover](../apps/desktop/src/main/TrayPopover.ts) 在每次右键打开时读取 [dsh-pet/tray-menu](../apps/desktop/src/main/dsh-pet/tray-menu.ts)，关闭后仍可恢复同一只 |

宠物角色列表固定先展示大肥鱼，再展示 Clawd、Bot、Doro、咕嘎、鸡哥ikun、罗小黑、Monthly salary cat（月薪猫）、小八和导入角色。六个图集角色随应用打包，无需导入或联网；已有相同 ID 的导入记录只显示对应内置选项，保留原有选择及本地文件。不再内置 Sprout、Byte、Ember，也不提供恢复这三项内置角色的按钮。导入角色仍可预览、应用和移除。底部「导入宠物」为两套宠物详情共用，均提供标准 ZIP、Codex 和链接导入，不因预览大肥鱼而隐藏；大肥鱼详情不再重复展示上游署名与许可提示，项目 README 保留相关引用。导入与移除反馈跟随触发操作：ZIP 及本地 Codex 读取反馈在对应按钮下方，链接导入反馈在输入框下方并通过 `aria-describedby` 关联，Codex 选中项导入失败保留选择并在确认按钮下方提示，移除反馈在角色列表下方。展示主进程按语言处理后的具体失败原因，IPC 等异常回退通用提示；重试、改用其他操作或编辑链接时清除对应旧反馈。

大肥鱼独立 helper 的交互与数据入口为 `apps/desktop/scripts/dsh-pet-interactions-runtime.js` 和 `apps/desktop/src/main/dsh-pet/companion.ts`；保留原视频播放器、右键动作菜单、身体命中及鼠标穿透。该经典 DOM 页面没有 React Provider，提示气泡和菜单沿用 helper 实现，不使用 FilterMenu。交互边界：悬停显示今日用量、参考 USD 费用和额度窗口，点击轮换回应动作与本机统计短句，右侧屏幕边缘收起并在悬停后展开（多屏接缝不收边），全画面倾斜遵守 reduced-motion；不增加独立眼神交互，也不使用 mini 素材。

### 业务内复用入口

通知会话定位复用共享 `SessionsPage` 与 `SessionActivityPanel.FocusedSession`：URL 的 `sessionSource + sessionId` 进行精确查询，自动打开详情弹窗；`sessionFocus` 让重复点击同一会话也重新定位。该模式不受列表分页/时间筛选遮挡，并明确显示读取的是已采集历史及服务端实际范围；缺记录时保留目标等待常规同步。关闭详情后焦点回到会话行，常规数据刷新不重新打开已关闭的弹窗。Dashboard 与 Desktop 使用同一页面和详情组件，`useSessionActivity` 两端同步支持目标参数，普通会话列表的筛选与关联展开行为保留。
浏览器只读演示由 HTML 的 `#quotern-demo` 元数据显式启用，`lib/demo-runtime.ts` 提供参考时钟与独立偏好键；普通浏览器默认实时、Desktop 适配器固定正常模式。AppShell 复用 StatusBanner 展示只读与参考日期；演示保留筛选、详情及内置分享卡下载，隐藏同步和在线额度，成就/服务器图库修改禁用。共享 AchievementProvider 的 `readOnly` 参数默认 false，分享组件的演示检查默认关闭，普通 Desktop 的 IPC、图库迁移和成就写操作保持原行为。只读是服务器 API 的强约束，不能仅靠隐藏按钮。日期包装仅改 Dashboard；独立 Desktop 日期副本继续使用实时时钟。

固定演示关闭统计、成就及图库的定时和 focus/visibility 自动刷新；初次加载、筛选变化、重试和显式同步事件继续读取。两端 `lib/dashboard-refresh.ts` 的 `subscribeAutomaticRefresh` 只管理自动订阅，初载与 `DATA_SYNCED_EVENT` 由调用方保留。Desktop 正常模式保持轮询与原有 IPC 新鲜度探测。

浏览器初始入口只注册 shell、usage 和 achievement 翻译；设置、价格和分享的四语言文案在功能模块加载时同步注册，必须先于首次渲染。Desktop 保留完整入口注册。浏览器的设置、关于、成就弹层内容，以及两端共享的分享内容经 `components/DeferredContent` 按需下载，失败提供刷新页面操作（浏览器可能缓存失败的模块导入）；成就加载/错误提示由可关闭的轻量 Modal 承载。轻量宿主始终保留打开事件、选中页签与分享快照，不能延迟订阅而丢失第一次点击。分享内容实现为 `ShareActivityModalContent`，宿主 `ShareActivityModal` 保持原入口。演示总览请求最近六条预览，用完整 `sessionCount` 与账单组计数显示跳转入口；完整会话页和 Desktop 正常模式保持全量读取。


| 能力 | 入口与使用点 | 适用边界及共享方式 |
| --- | --- | --- |
| 总览 Agent 多选 | [DashboardFilter.ToolChannelSelect](../packages/dashboard/src/components/DashboardFilter.tsx)，总览及 ShareActivityModal 使用 | 空数组表示全部。Desktop 总览/托盘使用自己的 DashboardFilter；共享分享弹窗使用 Dashboard 版本 |
| 热力图 Agent 多选 | [PlatformFilterSelect](../packages/dashboard/src/components/PlatformFilterSelect.tsx)，ActivityHeatmap 使用 | `value` 是具体选中集合；`[]` 表示无结果，全选可由 `applyPlatformFilterChange` 折叠成 `null`。与总览 Agent 不可混用空选语义 |
| 用量日期范围 | [DashboardDateRangePicker](../packages/dashboard/src/components/DashboardDateRangePicker.tsx)，DashboardFilter 使用 | 绑定统计时区、DashboardDateRange 和回看天数限制；Desktop 直接 re-export |
| 时间范围快捷选择 | [DashboardTimeRangeControl](../packages/dashboard/src/components/DashboardTimeRangeControl.tsx)，DashboardFilter 与 SessionsPage 使用 | “今天 / 1D / 7D / 30D / 90D / 自定义”的共享外观、选中态与日期选择器；调用者负责查询范围。会话页显式选择 1D 后复用滚动时间 hook，切换时间保留列表筛选并重置页码；两端直接引用同一组件，Desktop 登记 CSS `@source` |
| 初次加载/范围刷新 | [DashboardLoadingSkeleton](../packages/dashboard/src/components/DashboardLoadingSkeleton.tsx)、[DashboardRangeSyncOverlay](../packages/dashboard/src/components/DashboardRangeSyncOverlay.tsx)，DashboardPage 使用 | 骨架匹配当前总览槽位；刷新遮罩需要定位父级。两端有独立副本，Desktop 另用于托盘 |
| 来源占比条 | [SourceProgress](../packages/dashboard/src/components/SourceProgress.tsx)，AgentShareCard 使用 | 来源品牌色及百分比语义，两端各有副本 |
| 会话预览与归属 | [SessionActivityPanel](../packages/dashboard/src/components/SessionActivityPanel.tsx)，DashboardPage 使用 | 总览预览最近 6 条和用量归属；“查看全部”及关联入口带入当前范围，进入会话页；Desktop 直接 re-export |
| 会话浏览页 | [SessionsPage](../packages/dashboard/src/pages/SessionsPage.tsx)，两端 `/sessions` 路由与 FilterChromeActions 接入 | 共用 SessionBrowser、FilterMenu 与会话行；搜索、Agent/项目筛选、排序字段及方向、12 条分页及关联条件保存在 URL。宽布局表头支持最近活动、Token、费用排序，Token 与费用各占独立列；列宽按容器比例分配，避免多余宽度全部落入会话名称列。Token 占比在展开详情的服务/账号信息行展示，统计范围及占比说明收进该值的 Tooltip；窄布局使用排序菜单及方向按钮，任务时长排序也保留在菜单中。表头用 HeroUI Button 组合 `Table.SortableColumnHeader`，并显式复用 Table 排序标签及方向图标样式；完整 Table.Header 依赖表格集合，不适用于当前按根会话分组的列表。页头以时间控件表达范围，不重复统计范围/用量说明，不提供局部刷新及主题按钮；有总览来源限制时保留范围提示。总览日期（含滚动时间边界）和来源范围单独保留，清除列表筛选不会扩大关联范围。返回总览复用 dashboard-return-state；Desktop 路由直接引用共享页面并登记 CSS `@source`；模型筛选和日期/项目分组写入 URL；12 条按根会话分页，关联项折叠并支持子项模型筛选；点击会话打开 HeroUI Modal，保留通知精确定位与旧模型/归属信息；详情使用 SessionDetailDialog 与 SessionUsageBreakdown，SessionInsightDetails 保留兼容导出和 ContextAuditButton；Desktop index.css 登记共享组件 `@source`；所有 Select 仍走 FilterMenu |
| 会话详情 | [SessionDetailDialog](../packages/dashboard/src/components/SessionDetailDialog.tsx)、[SessionUsageBreakdown](../packages/dashboard/src/components/SessionUsageBreakdown.tsx)，由 SessionActivityPanel 打开；[session-detail](../packages/dashboard/src/lib/session-detail.ts) 统一展示口径 | 单一标题、固定四项操作及正文滚动区。默认“仅本会话”，存在后代时可切换“含关联会话”，联动总量、Token 构成和模型费用；按本会话/子代理/分叉/其他关联拆分，单成员直接展示身份与用量，多成员保留折叠；无后代省略不可切换的范围入口，旧 runtime 降级摘要保留。列表筛选不二次裁剪成员。普通详情以一行“所选期间用量”显示 runtime 实际范围；通知定位仍为已采集历史，时区放入数据说明。性能和活动固定为本会话且直接展示，分别保留样本和覆盖；少量会话信息直接展示，不增加折叠步骤；任务时长去掉“已记录计时”后缀，估算标识保留，来源与含义从相邻帮助查看；关联会话名称承接原历史链接，角色在名称旁展示并允许窄屏换行，不增加重复操作行；统计、口径、费用依据、响应样本和活动覆盖从相邻 HelpPopover 查看。Token 构成与模型费用共用 HeroUI Table，单模型且与整体一致时无重复合计，多模型或未归属差额时表尾显示普通背景合计；standard/unknown 不生成标签或副行。逐模型展示总 Token、输入/缓存/输出/推理、已知请求和费用；无模型明细时以紧凑缺失状态替代空表，摘要保留已知总量/费用/小计；非空的 unknown 模型仍显示为模型行。未知分类、未分类 Token 和未分配费用从帮助查看，窄屏只在有数据的表格区域横向滚动。Token 与费用格式遵循本文件「用量数字与模型单价」章节；极小非零、未知、零、已知小计分开；无详情专用精确/简洁模式，原始精度沿用列表 CSV 导出。用户明确要求删除会话 ID、项目路径及恢复命令原文和重复复制入口；账号、时间、计费和代理关系保留。复制成功使用应用 Toast（约 2.5 秒），不占标题区；动作错误保留附近反馈，目录失败可重试。旧 runtime 继续回退本会话明细和可用复制能力。Desktop 经 SessionActivityPanel 共用，index.css 登记两个组件的 `@source` |
| 上下文审计与兼容入口 | [SessionInsightDetails](../packages/dashboard/src/components/SessionInsightDetails.tsx) | SessionInsightDetails 兼容导出新详情弹窗；ContextAuditButton 保留只读上下文来源审计。列表 CSV 导出仍由 SessionActivityPanel 提供，不与详情 JSON 复制混用；Desktop 共用 |
| 会话本机操作 | [SessionDetailDialog](../packages/dashboard/src/components/SessionDetailDialog.tsx) | 顶部固定“继续会话 / 打开文件夹 / 复制恢复命令 / 复制项目路径”，复制能力独立于本机启动能力。两个本机动作通过 `/functions/tud-session-actions` 请求运行端从已采集记录解析的操作；执行中禁用两个动作按钮，固定操作区反馈启动结果及错误。不可用操作保留禁用入口并分别说明原因。动作 API 返回的恢复命令优先；显式 null 不回退到旧命令。旧/远程 API 保留复制回退，目录读取失败可重试。PI 使用核实的原始 JSONL，ZCode 按会话 ID 查询数据库目录；Antigravity CLI 使用 `agy --conversation <所选 ID>`，仅从已采集 CLI 原文件所属的 `cache/last_conversations.json` 精确匹配项目目录，目录未知时保留复制命令；不把桌面版 / IDE 记录直接当作 CLI 会话。DeepSeek Harness 需要兼容恢复的 profile，未适配时说明限制。Windows 使用系统默认终端宿主与 PowerShell，macOS 使用系统 Terminal，Linux 使用 x-terminal-emulator；不读取或切换用户终端 profile。Desktop 共用组件与 IPC transport |
| 趋势浏览 | [UsageTrendExplorer](../packages/dashboard/src/components/UsageTrendExplorer.tsx)，DashboardPage 使用 | 用量时间轴、动态粒度和费用分组；本地模式的两张图共同占满总览一整行，宽屏各占半宽、窄屏纵向排列。每张图的展开按钮打开 HeroUI Modal，复用当前数据、指标与分组状态，保留控件、Tooltip、图例和计价说明；Desktop 直接 re-export，并在 `index.css` 登记共享组件的 `@source` |
| 价格筛选与比较 | [PricingTools](../packages/dashboard/src/components/PricingTools.tsx)、[PricingMoreFilters](../packages/dashboard/src/components/PricingMoreFilters.tsx)、[PricingComparison](../packages/dashboard/src/components/PricingComparison.tsx) | 厂商、上下文、日期、汇率、渠道及估算场景属于价格业务；共享 PricingPage 的 loadCatalog 读取 runtime 生效表，Desktop 注入 IPC 价格与用量读取；runtime 不可用时回退内置目录；两端价格路由共用 parsePricingSearch，models 参数携带来源/模型集合，按保守身份解析筛选同一模型的渠道分组，保留清除入口及未匹配提示 |
| 用量分享 | [ShareActivityModal](../packages/dashboard/src/components/ShareActivityModal.tsx)、[ShareBackgroundPicker](../packages/dashboard/src/components/ShareBackgroundPicker.tsx)、[ShareCardCarousel](../packages/dashboard/src/components/ShareCardCarousel.tsx)、[ShareCardActions](../packages/dashboard/src/components/ShareCardActions.tsx) | 绑定分享快照、背景库和海报导出；Desktop 分享弹窗 re-export Dashboard。组件不作为任意轮播或上传器 |

当前没有统一的全页面 EmptyState；无数据、无匹配结果、读取失败由对应业务表达。新增页面先复用合适的 HeroUI 原件或现有业务表达，确有重复契约时再抽取。

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
- 搜索、全选、清除及底部动作保持可达；关闭、Escape、键盘导航和焦点恢复沿用原宿主契约。公共层不改变选中后是否关闭。
- 公共层不编码业务值，不把空数组、`all` 或 `null` 解释为统一含义；不承担筛选查询和持久化。
- 不在调用者通过 `style.maxHeight`、`!max-h-*` 或 overflow 类覆盖公共尺寸/滚动约束。特殊需求先评估扩展公共组件，再按总则记录例外。
- 级联模型菜单保留两个独立滚动列及固定搜索头，通过 `FilterMenuPopover` 的 `bodyClassName` 布局；其厂商/模型状态仍由业务组件管理。
- 浮层层级：React Aria 把触发器锚定的菜单和 Tooltip 固定为内联 `z-index: 100000`，两端 `index.css` 让 Modal 使用同一层级（按挂载顺序，即打开顺序决定前后），Toast 位于最上层。Modal 内打开的菜单仍在 Modal 之上；从 Toast 动作等顶层提示打开 Modal 时，先用 `lib/overlay-dismiss` 的 `dismissTransientOverlays` 关闭页面级菜单。

### 范围与例外

日期编辑器、计算器、解释性 Popover、原生系统窗口有各自布局合同，不套用列表菜单的 320px 上限。安装方式菜单和模型 ID 复制列表属于动作入口，按各自语义维护。

当前允许直接使用 HeroUI Select.Popover 的页面例外仅有 Desktop [SettingsPanel](../apps/desktop/src/renderer/components/SettingsPanel.tsx) 的 macOS 托盘模式设置与 [QuotaSettings](../apps/desktop/src/renderer/components/QuotaSettings.tsx) 的配额预测模式设置：均为固定三项、异步持久化的设置控件，本次保留原行为。新增例外需要同时更新这里的理由和对应检查范围。

## 验收与持续约束

1. 对照改动前检查选项、计数、单/多选、全部/空选、搜索、清除、选中后应用/关闭、分页是否保留。
2. 用内置浏览器检查真实页面：长列表、长名称、窗口变矮、选中项在末尾、鼠标滚动与键盘 End/Arrow/Enter/Escape、焦点返回触发器。确认最后一项可见可选，背景页面不被列表滚动带走。
3. 有固定头尾时，滚到底检查搜索/动作仍可见；嵌套 Modal 的菜单要单独检查。级联列、Desktop 托盘与原生窗口按实际可用环境补验，未实测必须说明。
4. 执行相关类型检查和测试。菜单公共入口策略由 [ui-menu-contracts.test.ts](../packages/dashboard/src/lib/ui-menu-contracts.test.ts) 检查两个 renderer 的直接 Select/Autocomplete 浮层用法（含命名导入别名）；它随 Dashboard 现有测试进入 CI。该检查不能代替视觉、滚动和键盘验收，自定义 Popover 的语义及复用由代码审查核对。
5. 按本节信息呈现矩阵验收默认界面和按需展开后的界面。单/多模型、完整/部分归属、standard/非默认档位、说明隐藏与打开、价格筛选/清除/未匹配都要检查；不能只测“字段存在”。[session-detail-presentation.test.ts](../packages/dashboard/src/lib/session-detail-presentation.test.ts) 和 [pricing-selection.test.ts](../packages/dashboard/src/lib/pricing-selection.test.ts) 随 Dashboard 测试进入三平台 CI；两端构建后运行 `corepack pnpm test:session-detail-ui`，由 [session-detail-smoke.mjs](../apps/desktop/scripts/session-detail-smoke.mjs) 实测 DOM、键盘、Popover 和窄屏。Windows CI 自动执行同一界面脚本。查看截图确认表头圆角、合计行与信息层级；自动断言不能替代视觉判断。

```bash
pnpm --filter quotern-dashboard exec tsc --noEmit
pnpm --filter quotern-desktop typecheck
pnpm --filter quotern-dashboard test
git diff --check
```

文档路径和组件默认行为应在同一变更中核对。当前先维护本项目的规范入口；反复出现且流程稳定的开发/验收操作，再考虑另建引用本文的 Skill。
