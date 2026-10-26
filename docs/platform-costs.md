# 平台费用与余额

本地面板与 Desktop 的操作栏新增「费用与余额」，进入 `/billing`。两端共用页面，分别经 HTTP / IPC 读取同一个 Core local-api 契约。默认最近 30 天，可选 7 / 90 天。

## 口径

- **本机日志费用**：现有本机已采集 Agent 的费用，保留费率估算、来源报告金额、采集起点、部分计价和覆盖不足。不是按平台项目过滤后的账单。
- **OpenAI 平台费用**：官方组织费用接口报告的金额，可能覆盖其他设备、应用与账号。可固定平台项目范围；不同币种分别列出，不转换后相加，不再加入本机费用总额，也不计算两者差额。

- **DeepSeek 余额**：现有 QuotaState 中的 CNY 余额，只显示已知值和陈旧状态。本页不会读取其凭据或刷新其额度。缺值为未知，真实零余额保留为零。

OpenAI 这里指 API 组织账务，不表示 ChatGPT 订阅费用或 Codex 订阅剩余额度。

平台使用 UTC 日桶；本机使用同一起止时刻筛选已有半小时桶起点，不能拆分桶内消费。本机与平台的来源、计价和采集范围仍不相同。日期、项目、账单项及原币种金额可在折叠明细中查看；覆盖与接入说明位于标题旁帮助入口。

## OpenAI 接入

只支持公开的 `GET https://api.openai.com/v1/organization/costs`，需要运行 Quotern 的进程环境提供 `OPENAI_ADMIN_KEY`，不是普通 project API key。可选 `QUOTERN_OPENAI_COST_PROJECT_IDS` 为逗号分隔的 `proj_...` 项目 ID（最多 20 个）；非法配置报错，不静默扩大到整个组织。

环境变量由宿主进程提供；已有 runtime 需按原有方式重启才能取得新环境。本功能不修改系统环境、Agent 登录文件或用户设置，不在网页输入/保存管理密钥。权限依据见 [OpenAI Admin API 指南](https://developers.openai.com/api/docs/guides/admin-apis)，字段与金额单位见 [官方 Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)。数组参数按 [官方 Node SDK 查询序列化](https://github.com/openai/openai-node/blob/master/src/internal/utils/query.ts) 的 brackets 形式编码。

打开页面与切换期间只读现有内存状态；**点击「刷新平台费用」才请求平台**，不后台轮询。相同凭据、项目、期间的并发刷新合并；变更配置不继承之前的金额。缓存仅属于当前 runtime，重启后为尚未查询，超过 30 分钟标陈旧。失败不保留为新鲜成功，部分结果明确为已知小计；缺金额不补零。只有完整响应确认没有费用记录时，才显示零。

目前没有接入公开官方充值/赠送余额或到期查询；OpenAI 的 `balance/grantedBalance/expiresAt` 为 null，`balanceStatus=unsupported`，不从费用反推剩余余额。此限制基于 2026-10-26 官方 API 文档检查，不代表网页账单页面没有这些信息。

## 边界与排障

接口为 `/functions/tud-billing?days=7|30|90`（只读）和 JSON `POST /functions/tud-billing/refresh`（仅 `{"days":30}`）。费用入口限定 loopback 页面，Desktop 的可信内存 IPC 单独启用；不支持 LAN/远程 Origin，演示 runtime 不提供此数据或刷新能力。

查询固定官方目的地、禁止重定向；每页 15 秒、整次 45 秒、单页 2 MiB、累计 8 MiB、最多 10 页与 10,000 条明细。结果剥离未知字段和原始异常；401/403/429 不自动重试。只有达到完整分页、有效金额和数值边界时才标完整；额度、余额与组织费用相互独立。

401/403 请核对管理密钥及组织权限；429 稍后显式重试。缺管理密钥、旧 runtime 或不支持的部署分别显示不可用信息。CLI 的 Node 网络沿用现有代理配置；Desktop 使用 Chromium session 的系统代理。自动化验证仅用合成响应，不代表真实组织权限与账单延迟已经完成联调。
