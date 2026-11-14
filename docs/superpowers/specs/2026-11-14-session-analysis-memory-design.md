# 会话分析历史缓存内存修复

## 证据与目标

在当前开发历史副本上逐轮更新 Codex 快照版本，相同七天查询在 GC 后的堆占用约为 417、621、825、1,029 MB，第五轮加载在 2 GB 堆限制下 OOM。旧范围缓存强引用完整旧 history；不同来源组合的 collector 缓存又持有旧 SourceSnapshot。

目标是及时释放已过期版本，保留全部历史、关联、价格、标题、筛选和导出，以及未变化查询的复用。Desktop 继续使用独立分析进程，不提高堆上限或定时重启。

## 方案

- 仅降低缓存条目数：仍会按旧版本体积积累，不能准确区分正在使用的来源。
- 定时重启或加大堆：延后故障，不能消除旧图保留。
- 采用来源代次失效：以内部 WeakMap 关联轻量有效性 token；替换、删除、写入和淘汰时释放相关 collector/history/range 引用。history 仍为纯数据。

容量淘汰只禁止持久缓存，不令当前已读数据无效，避免超过缓存容量时无限重读。真正版本冲突在同一操作内有界重试，不能等待自己的 pending Promise。桶、采集起点和价格变化同样淘汰旧范围；有效历史的 prepared WeakMap 继续复用。

## 验收

先添加能捕获旧版本驻留的子进程内存回归，并覆盖同 key 并发更新、来源删除、损坏恢复、来源组合及容量淘汰。运行 Core/Desktop 相关回归、类型检查和构建；对同一大历史副本重跑多轮更新并比较结果。实际 Electron 中覆盖冷/热查询、周期刷新、聚焦和加载期间设置操作，按 PID 记录内存及主窗口响应。私有产物仅放 `.quotern-dev/diagnostics/`。

main 起始干净，直接串行修复；完成适用验证和独立审查后创建本地原子提交。

## Windows 验证记录（2026-11-14）

- 内存回归在旧实现中失败：反复更新约 2 MB 夹具后额外保留约 23 MiB；修复后通过。
- 同一私有快照副本的 16 轮刷新在 2 GB 堆限制下全部完成，GC 后约 417–418 MB；旧实现第五轮加载即 OOM。该实测证明已复现的逐代累积路径得到修复，不保证任意单文件规模都能容纳于固定堆限额。
- 固定时钟后，改前改后的 232 个会话完整响应 SHA-256 相同；未裁剪历史或省略字段。
- 最终 Core 自动化：872 项，870 通过、2 项平台条件跳过、0 失败。Desktop 完整测试：948 项，928 通过、20 项跳过；类型检查通过。补充错误出口后，query/memory 22 项与 Desktop host/service 6 项重新通过。
- 独立 Electron 实机运行约 65.7 秒：冷查询约 5,552 ms、热查询约 170 ms，均返回 232 个会话；分析期间点击设置，约 552 ms 后确认弹窗已打开，截图可核对。聚焦后与周期刷新后的查询分别约 37、46 ms，均成功。主进程 33 次 Windows `Responding` 采样全部为 true；CPU profile 中 `readSessionHistory` / `aggregateSessionActivity` / `enrichSessionInsights` 自身采样为 0。分析 PID 保持不变，无 OOM 或重启，采样后段私有内存约 487–489 MB。
- 实机产物：`session-memory-desktop-20261114.json`、`session-memory-main-20261114.cpuprofile`、`session-memory-desktop-settings-20261114.png`。独立验收未携带桌宠 helper，日志中的 helper 缺失不属于本次源码变更；未验证桌宠、安装包、macOS/Linux 或跨夜运行。验收 Electron 及其分析子进程已退出，保留原 CLI。
- 私有采样与夹具位于 `.quotern-dev/diagnostics/`：`session-memory-*-20261114.jsonl`、`session-result-*-20261114.jsonl`、`core-oom-tests-final-20261114.log`、`desktop-oom-tests-20261114.log`。测试期间另一 CLI 会话占用 main 的 runtime 锁，实机验收采用当前源码的独立输出与数据副本，不停止该会话。
