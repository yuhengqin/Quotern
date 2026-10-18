---
"quotern": patch
"quotern-desktop": patch
---

Linux 和 macOS 开发启动器在确认旧会话及登记的进程组全部退出后自动恢复残留锁，避免异常退出后重复手动清理。仍有进程存活或归属记录不完整时继续保留锁。
