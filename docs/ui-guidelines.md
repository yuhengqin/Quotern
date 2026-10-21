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
| 应用 Toast 队列 | [AppToastContext](../packages/dashboard/src/components/AppToastContext.tsx)，AppShell 提供队列 | `useAppToastQueue` 必须位于 Provider 内；局部队列仍有合法使用场景，如价格页比较数量提示 | 独立 Context 和 `AppToastProvider`，后者避让窗口拖拽区 |
| 图表基础 | [ChartPrimitives](../packages/dashboard/src/components/ChartPrimitives.tsx)，TokenUsageTrendCard、UsageDistributionCard 等使用 | Recharts 容器、主题、Tooltip/Legend；数据转换与指标含义留在业务图表中 | 同名独立副本 |
| Agent 来源图标 | [ProviderIcon](../packages/dashboard/src/components/ProviderIcon.tsx)，会话、项目和 Agent 选择器使用 | Agent/采集来源标识及 fallback | 同名文件，分别核对资源与平台能力 |
| 模型厂商图标 | [ModelProviderIcon](../packages/dashboard/src/components/ModelProviderIcon.tsx)，价格列表与比较使用 | 模型厂商及渠道标识；不要替代 Agent 来源图标 | 随共享价格组件引用 Dashboard 源文件 |
| 订阅品牌图标 | [SubscriptionBrandIcon](../packages/dashboard/src/components/SubscriptionBrandIcon.tsx)，QuotaUsageCard 使用 | 订阅品牌；与 Agent/模型厂商有不同语义与资源集合 | 独立实现，Desktop 支持的品牌/资源更多 |
| 主题切换 | [ThemeToggle](../packages/dashboard/src/components/ThemeToggle.tsx)，FilterChromeActions 使用 | 跟随系统、浅色、深色循环与可访问标签 | 独立组件及主题 hook |
| 语言偏好 | [LanguagePreferenceControl](../packages/dashboard/src/components/LanguagePreferenceControl.tsx)，SettingsPanel 使用 | 四种语言单选，系统语言对应项标记“自动”并保存 `system`；`systemLocale` 独立于当前界面语言 | Desktop SettingsPanel 直接引用，系统语言由主进程提供 |
| 桌面宠物设置与原生托盘入口 | 浏览器端不提供 | 设置统一由角色列表选择编辑对象；两套宠物保留独立配置与生命周期，启用任意一方会自动关闭另一方，选择设置对象不切换启用状态。原生系统菜单使用 Electron Menu，不套用 FilterMenu；名称固定为「大肥鱼」，单击复选项切换唯一大肥鱼及后台任务的开关，历史网页显示位保留 | [PetSettingsCard](../apps/desktop/src/renderer/components/PetSettingsCard.tsx) 在同一卡片中展示内置/导入角色与大肥鱼，后者嵌入 [DshPetSettingsCard](../apps/desktop/src/renderer/components/DshPetSettingsCard.tsx)；切换编辑对象保留表单草稿。大肥鱼仅编辑单实例，不提供多开或目标选择；提供小、中、大三档，宽度分别为 160/204/264 px，角色可见高度约 71/91/118 px，与 Clawd 相近；不提供角落、水平偏移或垂直偏移数字项，也没有聊天入口。[TrayPopover](../apps/desktop/src/main/TrayPopover.ts) 在每次右键打开时读取 [dsh-pet/tray-menu](../apps/desktop/src/main/dsh-pet/tray-menu.ts)，关闭后仍可恢复同一只 |

### 业务内复用入口

通知会话定位复用共享 `SessionsPage` 与 `SessionActivityPanel.FocusedSession`：URL 的 `sessionSource + sessionId` 进行精确查询，自动展开已有会话；`sessionFocus` 让重复点击同一会话也重新定位。该模式不受列表分页/时间筛选遮挡，并明确显示读取的是已采集历史；缺记录时保留目标等待常规同步。Dashboard 与 Desktop 使用同一页面和详情行，`useSessionActivity` 两端同步支持目标参数，普通会话列表的筛选与展开行为保留。

| 能力 | 入口与使用点 | 适用边界及共享方式 |
| --- | --- | --- |
| 总览 Agent 多选 | [DashboardFilter.ToolChannelSelect](../packages/dashboard/src/components/DashboardFilter.tsx)，总览及 ShareActivityModal 使用 | 空数组表示全部。Desktop 总览/托盘使用自己的 DashboardFilter；共享分享弹窗使用 Dashboard 版本 |
| 热力图 Agent 多选 | [PlatformFilterSelect](../packages/dashboard/src/components/PlatformFilterSelect.tsx)，ActivityHeatmap 使用 | `value` 是具体选中集合；`[]` 表示无结果，全选可由 `applyPlatformFilterChange` 折叠成 `null`。与总览 Agent 不可混用空选语义 |
| 用量日期范围 | [DashboardDateRangePicker](../packages/dashboard/src/components/DashboardDateRangePicker.tsx)，DashboardFilter 使用 | 绑定统计时区、DashboardDateRange 和回看天数限制；Desktop 直接 re-export |
| 时间范围快捷选择 | [DashboardTimeRangeControl](../packages/dashboard/src/components/DashboardTimeRangeControl.tsx)，DashboardFilter 与 SessionsPage 使用 | “今天 / 1D / 7D / 30D / 90D / 自定义”的共享外观、选中态与日期选择器；调用者负责查询范围。会话页显式选择 1D 后复用滚动时间 hook，切换时间保留列表筛选并重置页码；两端直接引用同一组件，Desktop 登记 CSS `@source` |
| 初次加载/范围刷新 | [DashboardLoadingSkeleton](../packages/dashboard/src/components/DashboardLoadingSkeleton.tsx)、[DashboardRangeSyncOverlay](../packages/dashboard/src/components/DashboardRangeSyncOverlay.tsx)，DashboardPage 使用 | 骨架匹配当前总览槽位；刷新遮罩需要定位父级。两端有独立副本，Desktop 另用于托盘 |
| 来源占比条 | [SourceProgress](../packages/dashboard/src/components/SourceProgress.tsx)，AgentShareCard 使用 | 来源品牌色及百分比语义，两端各有副本 |
| 会话预览与归属 | [SessionActivityPanel](../packages/dashboard/src/components/SessionActivityPanel.tsx)，DashboardPage 使用 | 总览预览最近 6 条和用量归属；“查看全部”及关联入口带入当前范围，进入会话页；Desktop 直接 re-export |
| 会话浏览页 | [SessionsPage](../packages/dashboard/src/pages/SessionsPage.tsx)，两端 `/sessions` 路由与 FilterChromeActions 接入 | 共用 SessionBrowser、FilterMenu 与会话行；搜索、Agent/项目筛选、排序字段及方向、12 条分页及关联条件保存在 URL。宽布局表头支持最近活动、Token、费用排序，Token 与费用各占独立列；列宽按容器比例分配，避免多余宽度全部落入会话名称列。Token 占比在展开详情的服务/账号信息行展示，统计范围及占比说明收进该值的 Tooltip；窄布局使用排序菜单及方向按钮，任务时长排序也保留在菜单中。表头用 HeroUI Button 组合 `Table.SortableColumnHeader`，并显式复用 Table 排序标签及方向图标样式；完整 Table.Header 依赖表格集合，不适用于原生 details/summary 展开行。页头以时间控件表达范围，不重复统计范围/用量说明，不提供局部刷新及主题按钮；有总览来源限制时保留范围提示。总览日期（含滚动时间边界）和来源范围单独保留，清除列表筛选不会扩大关联范围。返回总览复用 dashboard-return-state；Desktop 路由直接引用共享页面并登记 CSS `@source` |
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
