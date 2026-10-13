# 订阅数据获取与接口注意事项

订阅额度由 Desktop 主进程读取，renderer 接收展示快照。本机 Token 统计与订阅余额分别计算；有历史用量不代表当前 Agent 已登录，有套餐名也不代表一定能取得额度。

## 数据流与职责

```text
本机 Agent 登录状态 / CLI / 本地服务 / 官方额度接口
  → 主进程 reader：发现、读取、超时、校验、缓存
  → shared mapper：转换字段、百分比、时间和套餐名称
  → preload：专用 IPC 方法
  → renderer：订阅额度卡片、刷新状态与订阅卡片开关
```

各订阅来源使用自己的 IPC channel、preload 方法和 shared 类型，当前没有统一的运行时 `getSubscription` 接口。新增订阅来源时同时核对 [main](../apps/desktop/src/main)、[shared](../apps/desktop/src/shared)、[preload](../apps/desktop/src/preload/index.ts) 与对应 renderer 卡片。

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
| [Codex](../apps/desktop/src/shared/codex-subscription.ts) | `hasAccount`、`fiveHour`、`weekly` | 窗口包含 `usedPercent`；窗口可为空 |
| [Claude](../apps/desktop/src/shared/claude-subscription.ts) | `hasAccount`、`fiveHour`、`sevenDay` | 长周期字段名与 Codex 不同 |
| [Cursor](../apps/desktop/src/shared/cursor-subscription.ts) | `cursorModels`、`otherModels`、`plan` | 模型池与合并套餐额度，不能改名为泛化示例中的 `primaryModels` |
| [Copilot](../apps/desktop/src/shared/copilot-subscription.ts) | `limits[].remainingPercent`、`unlimited`、可选 `exhausted` | 已是剩余比例；缺失比例可为 `null`，不能再次用 `100 - value` 解释 |
| [Kimi](../apps/desktop/src/shared/kimi-subscription.ts) | `limits`、`region`、可选 `source` | 区分账号区域与读取来源 |
| [ZCode](../apps/desktop/src/shared/zcode-subscription.ts) | `limits`、`provider` | 保留提供方区别 |

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

`usedPercent` 的剩余比例由对应 renderer 或辅助函数按 `100 - usedPercent` 计算；Copilot 的 `remainingPercent` 直接表示剩余。未知、零额度、耗尽与无限额是不同状态。余额型订阅来源还保留金额信息，缺分母时不能制造百分比。

各 mapper 按自身协议识别秒、毫秒或 ISO 时间；不要把某个订阅来源的转换规则推广为所有入口都接受同样格式。套餐名使用上游名称与有限归一化映射，不能据名称推断限额或刷新周期。

Kimi 桌面版与 Code 是独立来源，卡片选择有效读数，不拼接不同来源的套餐和额度、不把共享池相加。Code 只登录时无需启动桌面版。路径与账号要求见 [Desktop README](../apps/desktop/README.md#kimi-桌面版与-kimi-code)。

## 缓存和失败处理

当前读取器提供 `forceRefresh`，通常合并进行中的请求；绕过缓存不等于取消进行中的请求，也不保证上游提供新数据。各适配器的缓存语义不同：

- Codex / Claude 使用 [subscription-cache.ts](../apps/desktop/src/main/subscription-cache.ts)，按身份键区分，返回状态缓存 60 秒。只有临时失败才沿用最近成功数据并标记 `stale`；账号变化或认证等状态会清除成功缓存，generation 防止旧请求回填缓存。
- Copilot、Kimi 的 reader 有各自的身份与来源检查，行为以相应测试为准。
- Cursor、ZCode、MiniMax 等 reader 使用各自的 `lastSuccess`，可能先命中 TTL 再读取凭据；不能声称它们都已具备与 Codex / Claude 相同的身份隔离机制。

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

订阅额度卡片位于主面板概览卡下方，macOS 托盘复用相同卡片。设置中的订阅卡片开关默认开启，保存在 `localStorage` 的 `tud.subscriptionChannelVisibility`；关闭后不挂载对应卡片。开启卡片后，是否显示仍由各卡片的账号与数据状态决定，读取失败并不总是隐藏。

修改时覆盖以下场景：未安装、未登录、过期、读取失败、未知套餐、缺失窗口、无限额、账号切换、并发返回、强制刷新及暂存旧读数。以各 reader 和 shared mapper 的 `*.test.ts` 为入口，运行方式见 [Desktop 测试说明](../apps/desktop/README.md#测试)。
