---
"quotern-core": patch
"quotern": patch
"quotern-dashboard": patch
"quotern-desktop": patch
---

本地面板和开发 API 的默认端口调整为 `8252`，同步启动示例、帮助文本和开发代理。已有配置中的端口继续生效；需要切换时，先退出所属实例，再通过 `--port 8252`（开发模式使用 `QUOTERN_DEV_API_PORT=8252`）启动。
