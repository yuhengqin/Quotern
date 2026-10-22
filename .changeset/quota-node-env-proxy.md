---
"quotern-core": patch
"quotern": patch
"quotern-desktop": patch
---

Node 额度和服务状态请求遵守环境代理及 NO_PROXY，修复配置代理后仍因直连产生的 ENOTFOUND。本机回环请求继续直连，Desktop 的 Codex 网络适配保持独立。
