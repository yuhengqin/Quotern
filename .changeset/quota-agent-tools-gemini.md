---
"quotern-core": minor
"quotern": minor
"quotern-dashboard": minor
"quotern-desktop": minor
---

新增额度 CLI 状态、预测与安全来源诊断，以及三个只读 stdio MCP 工具。CLI 与 Desktop 分别发布版本化快照，默认查询不启动采集、不联网、不修复文件；显式刷新只调用已有且数据目录匹配的 CLI 服务。

新增 Gemini CLI 额度通道，只复用有效的 Google OAuth 明文登录缓存，保留逐模型窗口和服务端重置时间，不刷新凭据、推测周期或合并模型池。两端复用现有额度卡片和设置。
