# 订阅数据获取与接口注意事项

订阅额度由 Core 读取器在 CLI 或 Desktop 主进程中读取，网页及 renderer 只接收展示快照。本机 Token 统计与订阅余额分别计算；有历史用量不代表当前 Agent 已登录，有套餐名也不代表一定能取得额度。

当前网页面板、主窗口、托盘与宠物通过各自宿主的统一后台额度管理器消费上述 reader。动态窗口、通知、历史分析、刷新策略及偏好路径见 [订阅额度管理](quota-management.md)。旧的逐来源 IPC 继续保留兼容用途。

## 数据流与职责

```text
本机 Agent 登录状态 / CLI / 本地服务 / 官方额度接口
  → Core reader：发现、读取、超时、校验、缓存
  → shared mapper：转换字段、百分比、时间和套餐名称
  → QuotaManager：统一调度、身份隔离、历史、提醒和偏好
  ├─ Desktop preload：quota.getState / refresh / setPreferences / onChanged
  │   → renderer：订阅额度卡片、刷新状态与订阅卡片开关
  └─ CLI HTTP：/functions/tud-quota、/refresh、/preferences
      → Dashboard：订阅额度卡片、详情与刷新
```

各订阅 reader 保留自己的 shared 类型与 Desktop 兼容 IPC。新增来源时同时核对 [Core reader](../packages/core/src/quota/readers)、[shared](../packages/core/src/quota/shared) 原始类型与规范映射，以及 [runtime.ts](../packages/core/src/quota/runtime.ts) 注册和调度间隔。HTTP 仅返回规范 `QuotaState`，不返回凭据、账号标识或上游原始对象；拒绝不受支持的网页 Origin，刷新及偏好写入要求 JSON 并校验参数。Cursor/Copilot 使用可选 Node SQLite 与只读 sqlite3 回退，缺少两者时保留读取失败状态，不阻止 CLI 启动。

当前显示的订阅来源以 [subscription-channels.ts](../apps/desktop/src/shared/subscription-channels.ts) 为准，包括 Codex、Claude、Cursor、Copilot、Grok、Kimi、ZCode、Antigravity、Qoder、MiniMax、OpenCode、DeepSeek。Trae 和 WorkBuddy 的适配器文件不代表它们已经进入当前界面。

## 读取方式

| 方式 | 当前例子 | 注意事项 |
| --- | --- | --- |
| 本地认证文件加固定官方接口 | Codex | 只读 `CODEX_HOME/auth.json`，请求 wham usage，无需启动 Codex CLI |
| Agent CLI | Claude | 在临时目录调用 `/usage`，限制工具、MCP、settings 和会话保存，并控制时间与输出大小 |
| 本地登录数据库或认证文件加官方接口 | Cursor、Copilot 等 | 路径、账号匹配和失效状态按 reader 分别处理 |
| 正在运行的 Agent 客户端提供本地 IPC | Kimi 桌面版 | 先取得当前账号与有效令牌，再访问对应区域接口 |
| 本地服务或只读缓存 | 其他适配器的具体分支 | 只读取所需范围；快照可能不具备实时性 |

GUI 进程的 PATH 可能与终端不同。需要 CLI 的读取器应使用已有的 [cli-runtime.ts](../apps/desktop/src/main/cli-runtime.ts) 辅助逻辑，并覆盖 Windows shim、无 Node、超时与非零退出结果。第三方 CLI 自身如何处理认证由原 Agent 决定，不能从本应用没有写文件推断子进程绝无认证副作用。

## 实际响应字段

协议以各订阅来源的 shared TypeScript 类型为准。下列差异会影响渲染和校验，不能把所有快照强制套进同一种结构。

| 订阅来源 | 关键字段 | 语义 |
| --- | --- | --- |
| [Codex](../apps/desktop/src/shared/codex-subscription.ts) | `hasAccount`、`fiveHour`、`weekly`、`windows`、`resetCredits` | 动态窗口保留实际上报周期和模型限制；窗口可为空，重置次数独立展示 |
| [Claude](../apps/desktop/src/shared/claude-subscription.ts) | `hasAccount`、`fiveHour`、`sevenDay`、`windows` | 从 CLI 结果保留总额度和模型分组，不新增直接读取认证的路径 |
| [Cursor](../apps/desktop/src/shared/cursor-subscription.ts) | `cursorModels`、`otherModels`、`plan` | 模型池与合并套餐额度，不能改名为泛化示例中的 `primaryModels` |
| [Copilot](../apps/desktop/src/shared/copilot-subscription.ts) | `limits[].remainingPercent`、`unlimited`、可选 `exhausted` | 已是剩余比例；缺失比例可为 `null`，不能再次用 `100 - value` 解释 |
| [Kimi](../apps/desktop/src/shared/kimi-subscription.ts) | `limits`、`region`、可选 `source` | 区分账号区域与读取来源 |
| [ZCode](../apps/desktop/src/shared/zcode-subscription.ts) | `limits`、`provider` | 保留提供方区别 |
| [OpenCode](../apps/desktop/src/shared/opencode-subscription.ts) | `limits`，含 `five-hour`、`weekly`、`monthly` | 优先解析官方 `usage.*.percent/resetsAt`；兼容旧 `*Usage.usagePercent/resetInSec`。月周期长度未知时保留 `null` |
| [Antigravity](../apps/desktop/src/shared/antigravity-subscription.ts) | 全部有效模型的 `limits` | 每个模型独立读取 `resetTime`，不再将原始池截成两个 |

当前 shared 快照均含 `status`、`planLabel`、`message`、`fetchedAt` 和 `stale`；具体状态枚举、空值与附加字段由各类型定义。`fetchedAt` 与 `resetsAt` 使用 Unix 秒：前者表示获取时间，后者表示窗口刷新或到期时间，不能混用。

[subscription-snapshot.schema.json](./schemas/subscription-snapshot.schema.json) 是供应商无关的结构示例，未覆盖上述所有字段差异，不能直接校验全部运行时 IPC 响应。修改实际协议时以 shared 类型、mapper 和对应测试为依据；需要统一运行时 Schema 时，应先补齐所有订阅来源的字段并验证真实结构。

例如一个虚构的 Codex 就绪快照为：

```json
{
  "status": "ready",
  "hasAccount": true,
  "fetchedAt": 1790000000,
  "stale": false,
  "planLabel": "Pro",
  "fiveHour": { "usedPercent": 36.5, "resetsAt": 1790003600 },
  "weekly": null,
  "message": null
}
```

## 比例、余额与套餐

`usedPercent` 的剩余比例按 `100 - usedPercent` 计算；Copilot 的 `remainingPercent` 在规范映射中只转换一次。未知、零额度、耗尽与无限额是不同状态。余额型订阅来源还保留金额信息，缺分母时不能制造百分比；金额余额不参与百分比预测和托盘风险判断。

各 mapper 按自身协议识别秒、毫秒或 ISO 时间；不要把某个订阅来源的转换规则推广为所有入口都接受同样格式。套餐名使用上游名称与有限归一化映射，不能据名称推断限额或刷新周期。

OpenCode Go 的官方百分比已经是 0–100，`1` 不能当作比例值转成 100%；月重置也不等于固定 30 天。协议依据为 [v1.19.0 usage 路由](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/console/app/src/routes/zen/go/v1/usage.ts)及[早期响应实现](https://github.com/anomalyco/opencode/blob/2b8a596/packages/console/app/src/routes/zen/go/v1/usage.ts)。这些源码证明兼容结构，不代表已对所有版本和付费账号完成实测。

Kimi 桌面版与 Code 是独立来源，卡片选择有效读数，不拼接不同来源的套餐和额度、不把共享池相加。Code 只登录时无需启动桌面版。路径与账号要求见 [Desktop README](../apps/desktop/README.md#kimi-桌面版与-kimi-code)。

## 缓存和失败处理

当前读取器提供 `forceRefresh`，通常合并进行中的请求；绕过缓存不等于取消进行中的请求，也不保证上游提供新数据。各适配器的缓存语义不同：

- Codex / Claude 使用 [subscription-cache.ts](../apps/desktop/src/main/subscription-cache.ts)，按身份键区分，返回状态缓存 60 秒。只有临时失败才沿用最近成功数据并标记 `stale`；账号变化或认证等状态会清除成功缓存，generation 防止旧请求回填缓存。
- Copilot、Kimi 的 reader 有各自的身份与来源检查，行为以相应测试为准。
- Cursor、ZCode、MiniMax 等 reader 使用各自的 `lastSuccess`，可能先命中 TTL 再读取凭据；不能声称它们都已具备与 Codex / Claude 相同的身份隔离机制。

统一调度强制尝试刷新，并在主进程中以不可序列化的身份标记检查缓存归属。只有确认同账号时才沿用旧值；没有身份标记的旧快照不会进入当前账号卡片、历史或提醒。本地 Antigravity 引擎无法确认其账号时只显示实时读数，不采集账号历史。

新增或修改缓存时，应明确账号、来源、区域的键，以及认证失败、退出和并发迟到结果的处理。建议用测试固定这些边界，避免一次切换后展示上一账号额度。不要把“所有失败都可沿用旧数据”写成统一规则。

## 凭据与进程边界

以下是开发约束：

- 凭据读取与请求拼装留在主进程；IPC 只传递界面需要的字段，不传令牌、Cookie、认证文件内容或完整上游响应。
- 识别自定义端点和账号区域，不把不匹配的凭据发送到默认主机。网络 reader 使用受限目的地、超时及明确错误映射。
- 本应用直接读取认证文件时保持只读；调用 Agent CLI 的订阅来源另外考虑该 Agent 自身的行为。
- 用户可见错误只说明安装、登录、权限、兼容性或网络状态，避免展示包含凭据的底层响应。
- 本地日志或缓存降级只读取必要目录和大小范围；示例与测试使用虚构数据。

这些要求需要在每个 reader 中单独验证，不能仅因类型里没有 token 字段，就断言整个网络与认证过程已经满足所有边界。

## 展示与验证

订阅额度卡片位于主面板概览卡下方，macOS / Windows 托盘复用相同状态。设置中的通道开关默认开启，保存在 Electron `userData/quota/preferences.json`；关闭后停止该来源的后台读取和提醒。首次启动可迁移旧 `localStorage` 的通道选择。是否显示还取决于账号与数据状态，读取失败并不总是隐藏。趋势、节奏、提醒阈值与验证范围见 [Desktop 额度管理](quota-management.md)。

修改时覆盖以下场景：未安装、未登录、过期、读取失败、未知套餐、缺失窗口、无限额、账号切换、并发返回、强制刷新及暂存旧读数。以各 reader 和 shared mapper 的 `*.test.ts` 为入口，运行方式见 [Desktop 测试说明](../apps/desktop/README.md#测试)。
