# 额度与平台费用后续四项

用户授权：完成前次七项建议中剩余四项，多 Agent 调查，在新分支/worktree 实现。基线为已合并首批的 main `569552f6`；工作分支 `codex/quota-platform-workflows`，不隐式推送或合并。

## 方案

复用现有 Core reader、版本化快照、CLI/MCP 与 HTTP/IPC。相比每次查询直接联网或引入脚本插件，此方案保留已有身份、新鲜度、隔离和凭据边界。主代理负责设计和实现；三个只读 Agent 分别核实账号匹配、provider 重复配置、OpenAI 官方费用契约；后续独立审查与验证。

1. **声明式 provider 契约**：浏览器安全的 Core 数据表统一 ID/名称、平台与策略限制、认证类别、基础刷新间隔、状态页及能力。现有 13 个来源、顺序、间隔、profile/OMP 例外保持；reader 函数显式且类型穷尽绑定，不加载外部脚本。提供版本化 CLI 描述输出和契约校验。
2. **账号推荐**：纯函数读取同一个 quota snapshot。支持 provider、精确 model/group 或 feature 标识，默认检查账号共享池。已验证且新鲜成功的原生候选才可推荐；失败、OMP-only、身份未知、缺必要池、陈旧均有固定原因。只比较已知受影响池，排序采用最小剩余比例；不声称可用请求数、自动登录或切换。投影使用现有 provider ID 表达本快照内的账号去重引用，不输出 accountRef/邮箱/路径。旧快照缺该引用时保守未知。
3. **终端摘要**：`quotern prompt` 只读快照，单行、无 ANSI、限制来源和长度，明确 unknown/stale。提供 PowerShell 示例但不修改用户 profile，不消费 Claude statusline stdin。可固定 runtime/data-dir/provider。
4. **平台费用与余额视图**：OpenAI 官方 organization/costs，显式配置 `OPENAI_ADMIN_KEY`，可用 `QUOTERN_OPENAI_COST_PROJECT_IDS` 固定项目范围。只读 GET 显示现有内存状态；用户显式刷新才联网，不后台轮询、不写凭据。默认最近 30 天，可选 7/90 天，按 UTC 日桶与本机同一 instant 范围并列。成本保留币种、行项目/项目范围、分页完整性和错误码；缺金额不补零，异币种不相加。OpenAI 充值/赠送/到期为 unsupported；DeepSeek 余额只用现有 QuotaState，不触发其刷新。平台成本不计入本机 Token 费用总额，只有本机估价时不假装已查平台账单。

平台 reader 固定官方 HTTPS URL、禁止重定向、单页 15 秒、总请求 45 秒、每页 2 MiB、最多 10 页/8 MiB，总结果有上限。未知字段剥离；无原始响应/错误/密钥输出。401/403/429 为固定状态，不在查询内重试。内存缓存按凭据指纹、项目及日期范围隔离，失败和范围变化不复用旧金额。HTTP/IPC 复用 local-api，拒绝远程 Origin、非 JSON/未知参数；demo 不查询平台、不提供刷新。

## 验收

- 纯推荐覆盖无关模型耗尽、目标池耗尽、重复账号、旧快照、失效/未知身份、过期窗口、未知模型与功能池；无硬选第一名。
- prompt/推荐/MCP 查询不写文件、不创建服务、不联网；新 MCP 仅新增推荐工具，严格参数与 EOF 保留。
- descriptor 错误配置拒绝，runtime 来源/间隔/状态 URL 与原行为一致。
- 成本 fixtures 覆盖分页、零/缺失/异币种/溢出/坏数据、401/403/429、超时/限额；局部失败不伪装完整。
- 两端共用费用页面、各自 transport；现有格式化入口、FilterMenu、HelpPopover、demo 和旧 runtime 兼容。
- 全部相关包测试、构建、Desktop typecheck、独立代码审查；真实账号/OS 未测必须明确。
