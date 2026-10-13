---
"quotern-core": patch
"quotern-dashboard": patch
"quotern-desktop": patch
---

支持 Kimi 桌面版会员套餐与共享额度，显示 Free 计划和读取失败后的重试反馈，桌面版与 Kimi Code 可独立或同时使用，统一为一张 Kimi 订阅卡片，底层隔离缓存及故障，并补齐 Code 套餐名称与月度共享额度；未登录、登录过期和付费套餐首次读取失败时隐藏对应来源的卡片，任一端有可用订阅读数时仍正常展示。

补齐桌面版请求用量采集和项目归属，支持迁移数据目录、CLI 并存与增量去重，并识别已知桌面模型的厂商。
