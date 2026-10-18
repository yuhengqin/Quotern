---
name: 🐞 Bug 报告
about: 报告一个可复现的问题
title: '[Bug] '
labels: ['bug']
assignees: ''
---

<!--
感谢反馈！请完整填写以下信息。
缺少「端 / 版本 / 复现步骤」的 issue 我们无法定位，会被标记 need more info，14 天无回应将关闭。

不确定是不是 Bug、或只是想问用法？请走 Discussions：
https://github.com/yuhengqin/Quotern/discussions
-->

### 🖥️ 受影响的端

<!-- 勾选所有出现问题的端；不确定就只勾你实际在用的那个。 -->

- [ ] Desktop（桌面客户端）
- [ ] CLI（`quotern` 命令行）
- [ ] Dashboard（CLI 浏览器面板）

### 📌 版本

<!--
CLI：已安装的 quotern 包版本
Desktop：设置 → 关于
Dashboard：CLI 包版本；源码开发时注明提交与启动命令
-->

### 💻 运行环境

| 项 | 值 |
| --- | --- |
| 操作系统 | <!-- 如 macOS 15.3 / Windows 11 23H2 / Ubuntu 24.04 --> |
| Node 版本 | <!-- node -v，要求 >= 20；Desktop / Web 可不填 --> |
| 安装方式 | <!-- npm i -g / dmg / exe / 源码构建 --> |

### 🔌 涉及的数据源

<!--
哪个 Agent 的用量数据出了问题？如 Claude Code / Codex / Cursor / Copilot / Gemini / Cline / Zed 等。
与具体数据源无关（比如面板样式问题）请写「无关」。
-->

### 🔁 复现步骤

<!-- 请写成别人照着做就能复现的步骤。 -->

1.
2.
3.

### 🎯 期望结果

### 💥 实际结果

<!--
附上截图或完整报错文案。
日志在 ~/.quotern/logs/ 下：daemon.log（本地服务）、sync.log（本地采集）、notify.log（通知）。
贴关键片段即可，注意先去掉里面的敏感信息。
-->

### ✅ 提交前自查

- [ ] 我已搜索过[已有 issue](https://github.com/yuhengqin/Quotern/issues?q=is%3Aissue)，没有重复
- [ ] 我已阅读 [FAQ](https://github.com/yuhengqin/Quotern/blob/main/FAQ.md)
- [ ] 我已说明是否运行 Desktop / CLI，并附上 `quotern doctor` 或服务状态中的 runtime owner 信息
