---
"quotern": patch
"quotern-dashboard": patch
"quotern-desktop": patch
---

浏览器与 Desktop 面板后台更新时保留已有会话列表、图表及弹窗操作状态，失败时继续显示已有读数。统计轮询统一为 30 秒，最近 24 小时的时间边界每 60 秒推进，减少重复查询和阅读中断。
