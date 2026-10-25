# UI 组件与交互规范

适用于 `packages/dashboard/src` 和 `apps/desktop/src/renderer` 的新增页面、组件和交互修改。先读总则，再按任务阅读组件清单及对应交互章节。本文维护现役入口与适用边界；第三方 API 以根 AGENTS.md 指向的 `.heroui-docs/react` 为准。

## 总则

1. 按交互语义选择组件：先查下面的现有入口，适用时复用；能力不足时先评估扩展参数或组合，再决定新增。不要仅凭文件位于 `components/` 或名称相似，就认定可以通用。
2. 公共基础组件负责尺寸、溢出、焦点、键盘和可访问性等共同约束；业务组件负责数据、筛选值、指标含义及“全部/空选”的解释。抽取公共 UI 时保留原有信息、交互、错误/空状态和应用时机。
3. 同名文件可能是独立副本，也可能是 re-export。修改前核对实际 import：共享实现改源文件；独立副本分别处理和验收。共享浏览器模块保持 browser-safe；Desktop 引用 Dashboard 新组件时同步检查 `index.css` 的 `@source`。
4. 采用独立实现或绕过公共入口时，在变更说明中记录：现有组件为什么不适用、替代方案仍需保持的约束、验证结果。无需为正常参数配置额外建立审批流程；改变原有能力时遵守 AGENTS.md 的功能保留要求。
5. 新增、调整、移动或弃用公共入口时，在同一变更中更新本清单、适用边界和示例/调用点。组件实现是行为依据，本文是选择与维护入口。

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
| 图表基础 | [ChartPrimitives](../packages/dashboard/src/components/ChartPrimitives.tsx)，TokenUsageTrendCard、UsageDistributionCard 等使用 | Recharts 容器、主题、Tooltip/Legend；数据转换与指标含义留在业务图表中 | 同名独立副本 |
| Agent 来源图标 | [ProviderIcon](../packages/dashboard/src/components/ProviderIcon.tsx)，会话、项目和 Agent 选择器使用 | Agent/采集来源标识及 fallback | 同名文件，分别核对资源与平台能力 |
| 模型厂商图标 | [ModelProviderIcon](../packages/dashboard/src/components/ModelProviderIcon.tsx)，价格列表与比较使用 | 模型厂商及渠道标识；不要替代 Agent 来源图标 | 随共享价格组件引用 Dashboard 源文件 |
| 订阅品牌图标 | [SubscriptionBrandIcon](../packages/dashboard/src/components/SubscriptionBrandIcon.tsx)，QuotaUsageCard 使用 | 订阅品牌；与 Agent/模型厂商有不同语义与资源集合 | 独立实现，Desktop 支持的品牌/资源更多 |
| 外观偏好 | [ThemePreferenceControl](../packages/dashboard/src/components/ThemePreferenceControl.tsx)，SettingsPanel 的「应用」中紧随语言设置 | 明确选择跟随系统、浅色、深色，立即应用并保存；位于运行配置之前，不依赖配置读取成功。FilterChromeActions 不再提供主题按钮，所有浏览器面板均保留设置入口；存量 ThemeToggle 仅供旧页面使用 | Desktop SettingsPanel 直接引用同一控件，由各端独立主题 hook 提供状态与保存，Desktop 保留主进程系统外观广播 |
| 关于与仓库链接 | [AboutContent](../packages/dashboard/src/components/AboutContent.tsx)，设置「关于」与 AboutModal 使用 | GitHub 仓库链接位于版本信息下方，保留反馈和支持的 Agent 信息；仪表盘操作区不再单独展示仓库按钮 | 同名独立副本；仓库链接经原生 openExternal 打开 |
| 语言偏好 | [LanguagePreferenceControl](../packages/dashboard/src/components/LanguagePreferenceControl.tsx)，SettingsPanel 使用 | 四种语言单选，系统语言对应项标记“自动”并保存 `system`；`systemLocale` 独立于当前界面语言 | Desktop SettingsPanel 直接引用，系统语言由主进程提供 |
| 桌面宠物设置与原生托盘入口 | 浏览器端不提供 | 标题行提供唯一的「启用」开关；其下的通用区提供唯一的「大小」控件，修改当前已应用宠物系统的尺寸，切换预览不改变该控件的目标，两套系统仍各自保存尺寸；角色卡片仅切换预览与编辑对象，详情预览当前宠物时显示不可点击的「✓ 当前宠物」状态标记，预览其他宠物时通过「设为当前宠物」按钮明确应用；应用成功后同步更新当前状态，不额外显示全局「已设为当前宠物」成功提示。卡片边框表示预览对象，文字标记与标题状态显示当前宠物。两套宠物保留独立配置与生命周期，应用其他宠物时保留总开关状态，启用时互斥；关闭后保留当前系统、角色与设置，重新开启（含重启应用后）恢复已应用宠物，不跟随最后预览对象。导入成功仅预览新角色。托盘通用宠物开关恢复当前宠物，单独大肥鱼入口仍可直接启停大肥鱼。原生系统菜单使用 Electron Menu，不套用 FilterMenu；名称固定为「大肥鱼」，单击复选项切换唯一大肥鱼及后台任务的开关，历史网页显示位保留 | Windows 的设置窗口按「宠物 / 订阅 / 应用 / 关于」排列；首次打开默认展示「宠物」，后续打开保留已选页签，宠物右键设置入口直接定位「宠物」。[PetSettingsCard](../apps/desktop/src/renderer/components/PetSettingsCard.tsx) 由独立「宠物」页签承载，在同一卡片中展示内置/导入角色与大肥鱼，后者嵌入 [DshPetSettingsCard](../apps/desktop/src/renderer/components/DshPetSettingsCard.tsx)；切换编辑对象保留表单草稿。各角色详情统一以角色名、「预览」标签及当前状态标记或应用按钮组成标题行，不重复展示通用介绍文案。大肥鱼的普通启停状态由顶部统一展示，详情只补充启动中、运行错误与重试入口。大肥鱼角色卡片名称固定显示「大肥鱼」，不显示 dsh-pet 副标题，保留当前宠物标记。大肥鱼直接展示预览与设置，不显示「手动控制／宠物设置」分组标题；预览区下方与其他角色一致，按「平静、思考、多任务、连续使用、庆祝、休息」排列，宽屏单行六项、窄屏两行三项，依次播放「用鲸鱼尾巴拍打地面、舞狮头、原地左转奔跑、堆雪人、点击回应-开心跃动、哈欠连天」。打开大肥鱼预览时立即自动播放默认「平静」动作，系统减少动态效果偏好不抑制该预览；点击状态立即播放对应动作预览，再次点击同一状态从头重播；关闭大肥鱼时仍可预览。不显示原生视频控制条，也不提供额外的播放或查看额度按钮，其余设置组保留折叠。仅编辑单实例，不提供多开或目标选择；提供小、中、大三档，宽度分别为 160/204/264 px，角色可见高度约 71/91/118 px，与 Clawd 相近；不提供角落、水平偏移或垂直偏移数字项，也没有聊天入口。[TrayPopover](../apps/desktop/src/main/TrayPopover.ts) 在每次右键打开时读取 [dsh-pet/tray-menu](../apps/desktop/src/main/dsh-pet/tray-menu.ts)，关闭后仍可恢复同一只 |

宠物角色列表固定先展示大肥鱼，再展示 Clawd、Bot、Doro、咕嘎、鸡哥ikun、罗小黑、Monthly salary cat（月薪猫）、小八和导入角色。六个图集角色随应用打包，无需导入或联网；已有相同 ID 的导入记录只显示对应内置选项，保留原有选择及本地文件。不再内置 Sprout、Byte、Ember，也不提供恢复这三项内置角色的按钮。导入角色仍可预览、应用和移除。底部「导入宠物」为两套宠物详情共用，均提供标准 ZIP、Codex 和链接导入，不因预览大肥鱼而隐藏；大肥鱼详情不再重复展示上游署名与许可提示，项目 README 保留相关引用。导入与移除反馈跟随触发操作：ZIP 及本地 Codex 读取反馈在对应按钮下方，链接导入反馈在输入框下方并通过 `aria-describedby` 关联，Codex 选中项导入失败保留选择并在确认按钮下方提示，移除反馈在角色列表下方。展示主进程按语言处理后的具体失败原因，IPC 等异常回退通用提示；重试、改用其他操作或编辑链接时清除对应旧反馈。

大肥鱼独立 helper 的交互与数据入口为 `apps/desktop/scripts/dsh-pet-interactions-runtime.js` 和 `apps/desktop/src/main/dsh-pet/companion.ts`；保留原视频播放器、右键动作菜单、身体命中及鼠标穿透。该经典 DOM 页面没有 React Provider，提示气泡和菜单沿用 helper 实现，不使用 FilterMenu。交互边界：悬停显示今日用量、参考 USD 费用和额度窗口，点击轮换回应动作与本机统计短句，右侧屏幕边缘收起并在悬停后展开（多屏接缝不收边），全画面倾斜遵守 reduced-motion；不增加独立眼神交互，也不使用 mini 素材。

### 业务内复用入口

通知会话定位复用共享 `SessionsPage` 与 `SessionActivityPanel.FocusedSession`：URL 的 `sessionSource + sessionId` 进行精确查询，自动打开详情弹窗；`sessionFocus` 让重复点击同一会话也重新定位。该模式不受列表分页/时间筛选遮挡，并明确显示读取的是已采集历史及服务端实际范围；缺记录时保留目标等待常规同步。关闭详情后焦点回到会话行，常规数据刷新不重新打开已关闭的弹窗。Dashboard 与 Desktop 使用同一页面和详情组件，`useSessionActivity` 两端同步支持目标参数，普通会话列表的筛选与关联展开行为保留。

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
| 会话详情 | [SessionDetailDialog](../packages/dashboard/src/components/SessionDetailDialog.tsx)、[SessionUsageBreakdown](../packages/dashboard/src/components/SessionUsageBreakdown.tsx)，由 SessionActivityPanel 打开；[session-detail](../packages/dashboard/src/lib/session-detail.ts) 统一展示与复制投影 | 单一标题、固定标题/操作区及正文滚动区；统计期间采用 runtime 的实际范围。本会话/线程切换联动总量、Token 构成和模型费用，线程按本会话/子代理/分叉/其他关联拆分；成员由 Core 提供，列表筛选不二次裁剪。旧 runtime 缺关联快照时回退本会话明细并单独保留线程摘要。性能和活动固定为本会话，各自标注样本与覆盖；活动、身份、数据说明按需展开。窄屏模型名称独占一行。Token 遵循本地化 / K/M/B/T 偏好，费用统一 `$` 前缀、最多四位小数；极小非零费用用阈值提示，未知、零、已知小计分开。精确模式保留任务秒数；复制 JSON 随当前范围并包含原始精度，不带目录。恢复命令、项目目录、账号、ID 仍可查看/复制；目录失败可重试。更多动作复用 FilterMenuPopover。Desktop 经 SessionActivityPanel 共用，index.css 登记两个组件的 `@source` |
| 上下文审计与兼容入口 | [SessionInsightDetails](../packages/dashboard/src/components/SessionInsightDetails.tsx) | SessionInsightDetails 兼容导出新详情弹窗；ContextAuditButton 保留只读上下文来源审计。列表 CSV 导出仍由 SessionActivityPanel 提供，不与详情 JSON 复制混用；Desktop 共用 |
| 会话本机操作 | [SessionDetailDialog](../packages/dashboard/src/components/SessionDetailDialog.tsx) | “继续会话”和“打开项目目录”通过 `/functions/tud-session-actions` 请求运行端从已采集记录解析的本机操作；执行中禁用两个动作按钮，并在固定操作区反馈启动结果及错误。不可用操作保留禁用入口并分别说明原因；已知恢复命令仍可直接复制，目录可从“更多”或“会话信息”复制。动作 API 返回的恢复命令优先；显式 null 不回退到旧命令。旧/远程 API 保留复制回退，目录读取失败可重试。PI 使用核实的原始 JSONL，ZCode 按会话 ID 查询数据库目录；Antigravity CLI 使用 `agy --conversation <所选 ID>`，仅从已采集 CLI 原文件所属的 `cache/last_conversations.json` 精确匹配项目目录，目录未知时保留复制命令；不把桌面版 / IDE 记录直接当作 CLI 会话。DeepSeek Harness 需要兼容恢复的 profile，未适配时说明限制。Windows 使用系统默认终端宿主与 PowerShell，macOS 使用系统 Terminal，Linux 使用 x-terminal-emulator；不读取或切换用户终端 profile。Desktop 共用组件与 IPC transport |
| 趋势浏览 | [UsageTrendExplorer](../packages/dashboard/src/components/UsageTrendExplorer.tsx)，DashboardPage 使用 | 用量时间轴、动态粒度和费用分组；本地模式的两张图共同占满总览一整行，宽屏各占半宽、窄屏纵向排列。每张图的展开按钮打开 HeroUI Modal，复用当前数据、指标与分组状态，保留控件、Tooltip、图例和计价说明；Desktop 直接 re-export，并在 `index.css` 登记共享组件的 `@source` |
| 价格筛选与比较 | [PricingTools](../packages/dashboard/src/components/PricingTools.tsx)、[PricingMoreFilters](../packages/dashboard/src/components/PricingMoreFilters.tsx)、[PricingComparison](../packages/dashboard/src/components/PricingComparison.tsx) | 厂商、上下文、日期、汇率、渠道及估算场景属于价格业务；共享 PricingPage 的 loadCatalog 读取 runtime 生效表，Desktop 注入 IPC 价格与用量读取；runtime 不可用时回退内置目录 |
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

```bash
pnpm --filter quotern-dashboard exec tsc --noEmit
pnpm --filter quotern-desktop typecheck
pnpm --filter quotern-dashboard test
git diff --check
```

文档路径和组件默认行为应在同一变更中核对。当前先维护本项目的规范入口；反复出现且流程稳定的开发/验收操作，再考虑另建引用本文的 Skill。
