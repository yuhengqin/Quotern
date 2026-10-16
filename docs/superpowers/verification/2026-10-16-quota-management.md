# Desktop 额度管理验证记录

日期：2026-10-16。分支：`codex/quota-management`。基础提交：`3cb44a1fa09ee6d7c60bcb4f935088d8ccead89c`。

开发与运行均在独立 worktree `C:/Users/Admin/.codex/worktrees/quota-management/Quotern`，主工作区未修改。使用仓库固定的 pnpm 11.1.2（`corepack pnpm`），未新增产品依赖。

## 交付范围

| 功能 | 实现与验收 |
| --- | --- |
| 动态窗口与模型限制 | 保留稳定窗口 ID、模型分组、实际周期；Codex 额外限制与重置次数、Claude CLI 模型额度；三条以上展开 |
| 后台额度提醒 | 短周期 90%，长周期 70% / 90%，恢复提醒分别开关；首次基线、周期去重、账号隔离及过期时间语义 |
| 参考节奏 | 均匀、工作日、历史习惯；本地时区与至少十四个观察日期的门槛 |
| 历史与分析 | 九十天有效读数、六小时趋势、近九十分钟斜率与三点/三十分钟预测门槛；旧数据和缺少身份不预测 |
| 公开服务状态 | 配置了官方状态页的来源每十五分钟查询，状态与账号错误分开，失败保留原检查时间并标未确认 |
| 自适应刷新 | 基础间隔、交互/空闲、锁屏/电池、恢复、请求合并、Retry-After、指数退避与手动重试 |
| Windows 托盘 | 点击打开概览、右键菜单、风险图标与文字摘要、多屏边界与内容滚动；宠物复用统一额度状态 |

该能力位于 Desktop 既有订阅域，浏览器 Dashboard 的本地 Token/费用统计契约保持原状。使用方式与边界见 [额度管理说明](../../quota-management.md)。

## 自动检查

最终代码状态执行结果：

| 命令 / 测试套件 | 结果 |
| --- | --- |
| `corepack pnpm --filter quotern-desktop typecheck` | 退出码 0 |
| `corepack pnpm test` | 退出码 0，包含全仓构建和以下测试 |
| state-migration | 11 项，9 通过 / 2 跳过 |
| run-parallel | 3 项，全部通过 |
| dev-instance | 9 项，全部通过 |
| dev-runtime | 2 项，全部通过 |
| Core | 509 项，508 通过 / 1 跳过 |
| pricing-metadata | 6 项，全部通过 |
| Dashboard | 155 项，全部通过 |
| Desktop | 294 项，276 通过 / 18 跳过 |
| CLI | 21 项，18 通过 / 3 跳过 |
| 合计 | **1010 项，986 通过 / 24 跳过 / 0 失败** |

Core、Dashboard、Desktop 主进程/preload/renderer 与 CLI 生产构建成功。新增测试覆盖窗口归一化、无限/未知/耗尽区分、节奏和时区、周期切换、预测门槛、提醒去重、账号切换失败、占位账号与凭据轮换、状态迟到、偏好保存失败/损坏、历史清理、限流、退出和托盘定位。

独立只读审查发现并修正了跨账号失败回填、Antigravity 本地引擎误归属、占位账号身份碰撞、Kimi 多来源复制丢失私有身份、未知 reset 重放、到期时间误称重置以及区域标识等问题。新增回归先复现失败，再修正至通过。自动节奏测试也明确区分每日稀疏读数（退回均匀）与可用于学习的日内采样。

## 界面与真实运行

通过仓库隔离入口 `corepack pnpm dev:desktop` 启动 Windows Electron，使用 worktree 的独立数据目录。已验证：

- 真实 Codex `quota.getState` 返回 ready，可显示只有周窗口的快照及独立重置次数；未伪造不存在的 5h 窗口。
- 真实 IPC 设置保存后读取与还原；无效节奏参数被拒绝。
- Electron 中加载托盘 renderer，430 × 700 尺寸下内容内部滚动，无横向溢出。
- Chrome 受控快照验证四窗口展开/收起、刷新请求、趋势左右方向键、提醒复选框键盘操作、节奏选择、无限额和金额、390px 窄屏、深浅色；无 pageerror。
- 截图检查后修正卡片头部布局，避免套餐与按钮挤压来源名称。

本地截图、受控夹具、脚本和原始日志保留在忽略目录 `.plans/2026-10-16-quota-management/`：`ui-result.json`、`native-result.json`、`quota-wide.png`、`quota-narrow.png`、`quota-dark.png`、`native-main.png`、`native-tray-renderer.png`、`final-typecheck.log`、`final-workspace-test.log`。测试夹具已移出产品源码，开发服务已停止。

## 验证限制

- 其余来源在本机处于未安装、未登录、自定义提供方或认证失效等状态；其成功读数主要通过既有 reader 测试和受控快照验证，未声称逐个完成真实付费账号联调。
- Windows 物理托盘点击、图标在任务栏的显示和系统通知最终送达未通过原生桌面自动化实测；相关处理链路、定位/摘要、提醒决策和 Electron renderer 已验证。通知仍取决于系统设置和打包身份。
- macOS 专有行为及跳过项未在本机执行；本次完成生产构建，未制作或发布安装包。
