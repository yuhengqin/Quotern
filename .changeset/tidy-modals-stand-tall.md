---
"quotern": patch
"quotern-dashboard": patch
"quotern-desktop": patch
---

修复从新成就提示打开成就弹窗时，页面上已展开的筛选菜单盖住成就卡片的问题。弹窗现在始终位于页面级菜单之上，弹窗内打开的菜单仍在弹窗之上，Toast 保持最上层；从 Toast 打开弹窗时会先收起残留的筛选菜单。
