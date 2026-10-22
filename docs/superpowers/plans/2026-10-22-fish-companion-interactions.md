# 大肥鱼桌面交互实施计划

**Goal:** 为独立大肥鱼补齐用户已批准的点击轮换、用量气泡、悬停倾斜、睡醒、右键入口和右侧收边。

**Architecture:** 保留 vendor 快照，通过构建时注入的 Quotern runtime 扩展现有 PetSprite。宿主复用现有 PetController 统计快照及 QuotaState，通过现有鉴权管道提供数据和操作；保持两套宠物生命周期独立。

**Tech Stack:** Electron 35、TypeScript、经典浏览器 JavaScript、node:test、VM 和原生隔离 smoke。

**Spec:** 本聊天用户批准上一轮适配表，排除独立眼神、Clawd 完整姿态与 mini 素材。

## 约束及验收重点

- 不修改清单管理的 vendor 文件；保留点击 Q 弹、飞行抓取得分、拖拽、甩抛、随机动作、动作菜单、额度与真实工作状态。
- 视频按实际 ended 恢复状态，不使用固定 2.5 秒截断；用户输入优先，控制锁、拖拽和已有提示有明确让位规则。
- 统计失联时显示不可用；费用标记为参考费用，不将其称为账单或余额。
- 右边停靠使用完整角色，只露出可命中的身体边缘；展开时停漫游，拖出后解除；保存可恢复位置，屏幕变化后重新夹取。
- 减少动态效果时停用倾斜和滑动过渡；隐藏/退出不保留新计时器。

## Task 1: 宿主数据与菜单操作

Files: `src/main/dsh-pet/companion.ts`、`companion.test.ts`、`service.ts`、`service.test.ts`、`controller.ts`、`index.ts`、`rpc.ts`、`rpc.test.ts`，以及 `src/main/index.ts`。

- [x] 写测试确认统计/额度格式、未知状态、文案轮换池、同步/设置路由。
- [x] 运行测试，确认新能力缺失造成失败。
- [x] 注入只读统计 getter 及同步/设置回调；在现有 state 的 companion section 发布变化。
- [x] 运行定向测试及类型检查。

## Task 2: renderer 交互及收边

Files: `scripts/dsh-pet-interactions-runtime.js`、`dsh-pet-interactions.test.mjs`、`dsh-pet-position-store.cjs`、`dsh-pet-position-store.test.mjs`、`patch-dsh-pet-pointer.mjs`、`prepare-dsh-pet.mjs`、`package.json`。

- [x] 写生成运行时测试，覆盖点击完整轮换、悬停信息/倾斜、工作与控制抢占、睡醒、停靠/展开/拖出/重启恢复。
- [x] 确认新能力测试失败后实现注入；复用真实 video ended 和现有输入链。
- [x] 在原生鼠标采样中仅推送闲置/活动状态变更，不增加全局鼠标转发或键盘监听。
- [x] 执行运行时测试，确认旧控制测试继续通过。

## Task 3: 集成与验收

- [x] 同步 Desktop README、UI 规范、PATCHES 与 changeset，注明独立 helper 使用自有播放器/菜单，FilterMenu 不适用于该页面。
- [x] 执行完整仓库测试（包含构建）与 Desktop 类型检查。
- [x] 用全新私有目录运行 Electron smoke，验证真实视频、点击、悬停、睡醒、停靠及菜单路由；核对无意外移除的旧交互。
- [x] 独立代码审查、处理问题并定点复验；报告物理鼠标/异构多屏等未覆盖边界。

验收结果：全仓测试及构建通过（1,798 项成功、35 项跳过），Desktop 类型检查通过。全新私有目录下的 Electron 检查 28/28 通过，包括真实视频轮换、闲置点击后恢复睡眠、菜单路由、收边展开及立即重启恢复。两轮独立审查发现的问题均已修复并补回归检查。未人工验收实际鼠标手感、不同 DPI 多屏和热插拔；未制作安装包或发布。
