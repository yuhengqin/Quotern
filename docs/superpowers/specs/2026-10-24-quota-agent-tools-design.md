# 额度查询、来源诊断与 Gemini CLI

用户确认首批范围：额度 CLI / 只读 MCP、来源诊断、一个新增额度渠道。使用独立 `codex/quota-agent-tools` 分支及 worktree，不合并、不推送。

## 方案与边界

沿用 Core QuotaManager 和两端现有额度 UI。新增 Gemini CLI reader；所有渠道增加安全的读取诊断。CLI 与 Desktop 各自将不含配置目录、认证材料、原始错误的版本化快照发布到 Core dataDir 下 `quota-snapshots/cli.json` / `desktop.json`，两个写入者不共用文件。CLI / MCP 只读这些文件，不初始化 runtime、修复配置、同步日志或轮询供应商。

比较过三种入口：每次创建 runtime 会丢失内存状态并产生第二个历史写入者；只走 HTTP 无法覆盖 Desktop；选择独立只读快照。历史与偏好文件继续分别归 CLI / Desktop 所有。默认选择最近生成的一个完整快照，不跨 runtime 拼接；可显式选 cli/desktop。

`quotern quota [--json] [--provider ID] [--runtime latest|cli|desktop] [--data-dir DIR]` 查询状态，`quotern quota diagnostics` 查询安全来源诊断，`quotern quota forecast` 仅投影有效预测。缺快照、损坏、陈旧、未采集与真实零额度明确区分。额外 `--refresh` 仅通过已有 CLI HTTP runtime 请求刷新（可指定 --port），不会启动服务；Desktop-only 使用现有桌面刷新按钮。MCP 无刷新/设置/登录/切换账号工具。

MCP 使用官方 TypeScript SDK 1.x 稳定维护线，stdio 协议输出与日志分离，工具 `quota_status` / `quota_forecast` / `quota_diagnostics` 只允许 provider 筛选，文件位置由启动参数确定。参数拒绝未知字段，结果含版本、生成/读取时间、来源与覆盖状态，支持 text 和 structuredContent；EOF/信号正常关闭。

诊断由固定来源/阶段/错误码、查询时间、耗时、缓存/OMP 回退、下次重试时间组成，不接受任意 URL、headers、原始异常、邮箱或目录。通用 manager 保留最终读取状态；capture 上下文记录网络；Codex/Claude/Gemini 记录认证和解析阶段。原有账号切换、generation、退避、通知规则不变。

Gemini 首版仅支持 `security.auth.selectedType=oauth-personal` 及未过期明文 `oauth_creds.json`，尊重 `GEMINI_CLI_HOME`（追加 `.gemini`）。只调用 loadCodeAssist 与 retrieveUserQuota，不刷新/写回凭据、不 onboarding、不切换网页或 Antigravity 账号。缺模式、加密存储、过期、无项目、401/403/429、响应不兼容有明确状态。保留逐 model/tokenType 额度与服务端 reset；不猜周期长度或共享池、不把缺失比例当零、不推断 JWT 为服务端验证身份。

## 验收

- 默认 CLI/MCP 查询在 Desktop owner 存在时仍不写任何文件或联网。
- 快照有体积/字段/数值校验，过期预测清除；不泄漏凭据、目录、原始错误；读坏文件不修复。
- 独立 CLI/Desktop 快照、账号切换、stale fallback 和 Retry-After 诊断可解释。
- Gemini 用脱敏模拟响应覆盖成功/零额度/坏数据/过期/权限/超时/限流；无真实账号操作。
- stdio MCP 客户端集成测试覆盖 initialize、tools/list/call、非法参数和 EOF。
- 两端 Gemini 显示与渠道设置共用现有通用组件；构建、相关测试和独立代码审查通过。
