---
"quotern": patch
"quotern-desktop": patch
---

Windows 开发模式使用 `QUOTERN_DEV_HOST=0.0.0.0` 时，端口预检同时检查本地 IPv4 网卡，避免遗漏绑定到单独网卡的已有服务。显式指定的占用端口会报错，自动端口选择会避让。
