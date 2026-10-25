---
"quotern-core": patch
"quotern": patch
"quotern-desktop": patch
---

修复继续会话时继承服务的 TERM=dumb、NO_COLOR 与 CI 环境导致的 Codex 警告和 Claude 无颜色问题，保留用户认证及 Agent 配置。

使用 Codex 最新工作目录，补充 PI 原始会话文件和 ZCode 会话目录查询及恢复命令。预检本机 CLI，并在缺少目录、程序或未核实恢复协议时保留操作入口与具体原因；已有复制功能继续可用。
