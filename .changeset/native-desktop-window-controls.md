---
"quotern-desktop": minor
---

Windows 桌面端改用 Electron 原生窗口控件（Window Controls Overlay）：标题栏隐藏但保留系统绘制的最小化/最大化/关闭按钮，恢复 Snap Layouts 贴靠面板、双击标题栏最大化与标题栏系统菜单；overlay 背景与图标色随主题同步。Linux 自绘窗控同步对齐 Win11 规范：按钮 46×32 贴右上角、关闭悬停 `#C42B1C` / 按下 `#B22A1E`、最大化后显示双叠方框还原图标，并为键盘补上可见焦点环。macOS 保持原生红绿灯。标题条高度统一由 `shared/window-chrome.ts` 的 `TITLEBAR_HEIGHT` 驱动。
