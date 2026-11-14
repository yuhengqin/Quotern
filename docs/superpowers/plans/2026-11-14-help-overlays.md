# WeKnora 风格帮助浮层实施计划

**目标：** Dashboard 与 Desktop 的简短提示采用深色 Tooltip，标题/段落/列表说明采用悬停展开的非模态浮层，完整保留现有内容和操作。

**依据：** 2026-11-14 通过 SSH 阅读 WeKnora Toolbox.vue、SkillSettings.vue、SandboxSettings.vue，并用内置浏览器验证技能页和沙箱设置：短提示为 #242424/白字、14px/1.55、340px 上限、6px 圆角、4px 8px 内边距和箭头；富说明为主题容器色、无箭头、相同圆角/内边距、13px/600 标题、12px/1.55 正文、4px 间距、340px 内容上限。移入浮层保持，移出收起。

**已确认需求：** 用户明确要求完整参考 WeKnora，包含原先点击打开的 HelpPopover。

**实现选择：** 继续使用 React/HeroUI；已有 React Aria 1.20 PreviewTrigger 负责 hover/focus/长按、进入浮层的安全区域及键盘访问。复用 HeroUI Popover.Content 和主题变量，避免引入 Vue/TDesign 或另写计时器/定位系统。短提示通过公共 Tooltip 包装统一箭头和样式。

## 约束

- main 干净且无明确并行写任务，直接在 main 修改并提交。
- 仅说明浮层；筛选、菜单、模态操作和图表数据提示沿用其业务交互。
- 不删统计依据、价格链接、缺失来源或精度说明；Token/费用继续复用现有格式化。
- 两端独立副本一起修改；共享 CSS 与新增公共组件同步登记。
- 悬停不移动焦点、不锁页面；Escape、外部点击、祖先滚动关闭；内部滚动保留。
- 触摸和键盘仍可打开说明；点击原业务按钮仍执行原动作。

## 实施

- [x] 在现有双端 UI 驱动加入悬停完整说明、移入保持、移出关闭、不抢焦点及短提示皮肤检查，先确认旧实现失败。
- [x] 改造 HelpPopover，提供可复用的 HelpPopup；迁移总览、会话指标、费用、设置、服务状态和 Token 单位兼容入口。
- [x] 添加公共短 Tooltip 包装和共享浮层样式，迁移 HeroUI Tooltip 引用；保留原操作与指定位置。Desktop 更新按钮因既有原生标题栏约束保留本地气泡，复用相同皮肤。
- [x] 同步 UI 规范；构建双端并运行相关单测、帮助/热力图/会话详情 UI 验收。
- [x] 用内置浏览器复查 5195 实际页面及截图，独立审查变更；适用检查通过后创建本地原子提交。

## 验收重点

悬停即可看到完整统计依据；离开触发器移入内容不会消失；链接/details 可操作；单个 Escape 不关闭父 Modal；页面滚动与内部滚动行为保持；窄屏、明暗主题和单位设置继续有效；普通按钮的 Tooltip 保持可读，点击业务动作不被悬浮说明吞掉。

## 验证结果

- 旧实现的完整说明 hover 验收按预期失败；实现后双端通过 `--help-hover-only`。
- 独立审查指出 Escape 同时关闭多个浮层的风险；实际新增「单价明细上悬停帮助，一次 Escape 保留单价明细」检查复现后，加入共享的最上层判断并修复。
- `corepack pnpm build`、Dashboard build、Desktop build/typecheck 和 Dashboard 全部单测通过。
- `corepack pnpm test:heatmap-legend-ui`、`corepack pnpm test:session-detail-ui` 通过。后者原有模拟 IPC 仍输出 appearance/quota navigation 缺失 handler 警告，断言与退出状态通过。
- 双端帮助验收产物：`.quotern-dev/session-pagination-ui-1794651092385-38016/`；热力图：`.quotern-dev/session-pagination-ui-1794651092413-3240/`；会话详情：`.quotern-dev/session-detail-ui-1794651275091-67736/`。
- 内置浏览器实测 5195：输入 Token 的标题/公式浮层、总 Token 完整构成和统计依据、深色短提示及 Escape。触摸长按由 PreviewTrigger 提供，未做真实触屏设备验收。
