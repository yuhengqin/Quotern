---
"quotern-dashboard": patch
"quotern-desktop": patch
---

修复使用 pnpm 共享依赖存储时，网页和 Desktop 开发服务中的 JetBrains Mono 字体请求被拦截的问题；仅放行字体资源目录，保留其他文件的访问限制。
