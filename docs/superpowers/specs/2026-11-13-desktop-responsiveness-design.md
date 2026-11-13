# Desktop 会话查询与进程探测性能修复

## 已确认的问题与目标

用户要求修复会话分析重复计算、重计算阻塞 Electron 主进程，以及同步 PowerShell 进程探测造成的周期卡顿。实机主进程 45 秒采样约 19.6 秒位于 enrichSessionInsights，其中约 16.4 秒位于 sessionDispatches。首页自动重验证会重复进入此路径。Windows watchdog 每约 30 秒同步探测两个进程字段，实测约 0.7 秒。

目标是保留全部会话、费用、关联、筛选、分页及导出语义，同时保证分析和进程探测不会占住主进程。CLI/demo 继续兼容现有 API；不改变通知、桌宠或刷新偏好。

## 方案与取舍

1. 仅优化算法：减少工作量，但数据增长仍可能冻结主窗口，不能独立满足要求。
2. 仅移动查询：窗口能响应，但反复重算浪费资源。
3. 同时建立索引与缓存，并把 Desktop 重查询隔离到 utilityProcess；采用此方案。它沿用现有 Electron 子进程与 Core API，代价是一个按需启动的只读分析进程。

## 设计决定

- dispatch 分析在一次 enrichment 中共享 metadata/目标会话索引，保留 recorded/inferred、时间窗、歧义与重复派发的现有规则。
- SessionQueryService 复用已完成的 hydration，并合并相同范围在途构建。缓存受 bucket revision、历史快照身份、价格、查询范围控制；返回值不能让调用方过滤/改写污染缓存。账号标签保持读取最新状态。
- Desktop 在 localApiRequest 边界把允许的只读 session/metrics/performance 路由送往专用 utilityProcess，子进程复用 createLocalApiApp 的参数与来源校验。主进程传递当前桶、配置、价格与账号标签快照，避免分析进程重读整份 append-only queue。更新按版本发送，查询串行执行；结果仍为现有 status/body。
- 分析进程故障、超时或退出时拒绝所属请求，下次请求可以重新建立进程；不得静默回退主线程执行。应用停止/恢复时回收该进程，旧代响应不能完成新代请求。
- 同样读取大型会话快照的额度历史查询复用此进程，主进程在返回前再核对所请求账号 revision，避免查询期间切换账号后接受旧结果。runtime 停止期间拒绝新请求。
- getRunningOwner/writeRuntimeOwner 等异步入口使用异步进程探测，Windows 一次查询两个字段并合并并发探测。公开同步 helper 保持兼容；不改变 PID 复用、未知进程、运行归属与驱逐保护规则。

## 验收

- 真实回归测试覆盖 dispatch 歧义/显式目标、索引不重复扫描，缓存重用与同步/价格失效、调用方隔离。
- 慢进程探测期间事件循环继续运行，原有 runtime-pid 安全测试保持通过。
- 子进程成功、失败、超时、停止、旧代响应及快照更新得到测试；真实 Electron 冒烟确认重查询不在主进程。
- 运行 Core/Desktop 适用测试、类型检查和构建；使用原有私有开发数据复测主进程采样并确认本次进程全部退出。
- 当前 main 干净且无其他可写任务证据，直接 main 串行实施；通过验证后创建本地原子提交。

## Windows 验收记录（2026-11-13）

- `corepack pnpm test` 最终完整通过，含全包构建：2,376 项，2,340 通过、36 项按平台/环境跳过、0 失败。Desktop `typecheck` 通过。
- 回归先后覆盖：重复 metadata 扫描、同范围并发/缓存重用、结果修改隔离、会话写入/价格/标题删除失效、慢进程探测可调度、worker 快照/退出/超时/发送失败、停止中及冷启动等待中的请求、额度附加账号槽位与查询期间账号切换。
- 同一隔离开发目录的 45 秒主进程 V8 采样：`enrichSessionInsights` 含子调用的采样耗时由约 19,610ms 降为 0，`sessionDispatches` 由约 16,363ms 降为 0；主进程空闲采样约 39,594ms。分析进程真实查询返回 200。
- 最终运行采集到 21 次 Windows `Responding`，全部为 true；诊断 supervisor 正常退出，主进程、采集与分析进程均已回收。此记录覆盖当前 Windows 开发入口，未执行 macOS/Linux 或正式安装包实机验收。
- 原始 V8 与测试日志保留在本机 `.quotern-dev/diagnostics/`，基线 `profile-summary-20261113.json`、结果 `profile-summary-after-20261113.json`、完整验证 `workspace-responsiveness-final-20261113.log`。
