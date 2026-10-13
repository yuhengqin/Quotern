---
"quotern-core": minor
"quotern": minor
"quotern-dashboard": minor
"quotern-desktop": minor
---

浏览器面板和 Desktop 共享同一台机器上的分享背景图库，切换浏览器后也能使用已保存的背景。旧浏览器图库与 Desktop 图片会自动去重迁移，满额时保留旧图并提示处理，不覆盖已有素材；原图库保留为备份。

分享窗口打开或重新获得焦点时自动更新图库，同时保留当前选择；读取失败或迁移未完成时提供重试入口。

保存前完整解码 PNG、JPEG 和 WebP，损坏图片不会替换已有背景。CLI 的 Node.js 运行要求更新为 20.10+。
