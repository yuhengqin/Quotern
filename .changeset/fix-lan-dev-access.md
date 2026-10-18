---
"quotern-core": patch
"quotern-dashboard": patch
"quotern-desktop": patch
---

修复局域网访问面板时成就操作被拒绝的问题。开发模式支持通过 `QUOTERN_DEV_HOST=0.0.0.0` 开放 CLI API、浏览器面板和 Desktop renderer，并正确避让其他网卡已占用的端口；未设置该变量时仍仅监听本机。
