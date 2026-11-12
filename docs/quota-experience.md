# 额度与会话活动体验

在已合入的账号启动与实际消费功能上，完成参考项目对照中的体验改进。

## 使用入口

- 总览「监控目录」以账号别名、验证状态和可用额度为主，配置目录按需展开。「启动默认」作用于后续 `quotern launch`，不能据此判断已运行终端的身份。
- 额度卡保留「剩余」文字、重置时间和风险窗口；耗尽预测同时显示剩余额度。陈旧/未知观测不产生新的预测。
- 「额度历史」保留周期与本地用量依据，增加本周期、5h、24h、7d、30d、前后浏览和回到现在。选择第二个窗口可比较，实线/虚线及名称表示窗口；各周期和回拨段分别绘制，不跨段连线。周期列表显示首次观测和状态，完整已知/未知起止和覆盖范围仍在选中周期摘要中。
- 额度详情「此账号的额度提醒」提供标准、仅耗尽与重置、自定义和关闭。自定义为 1–99 之间最多五个不同的已用百分比阈值；100% 耗尽单独保留。同一已验证账号的默认目录与附加目录共用规则，仍受全局提醒开关和目录提醒开关约束。更改规则后，从新的有效读数建立基线，不追发旧阈值。
- 设置「Agent 集成」的自动开窗区域显示读取、身份、重置、此前观测、所有权等等待原因及最近请求结果。「请求完成」只代表 CLI 请求结束，窗口是否开启仍需新额度读数确认。不确定结果不自动重试。
- 总览「会话活动」和 Desktop 托盘的同名展开区显示项目、Agent、工具、观测状态与时长，使用原有 `claudePane` 开关与可选 hooks。已安装旧版 hooks 时，可点「更新 hooks」刷新事件集合；其他 hooks 保留。仅 Claude 安装增加工具事件；Codex 展示实际收到的事件。普通工具结果、回合结束均不标为任务成功。两分钟无新事件或读取失败后显示旧状态。
- 托盘继续使用紧凑额度摘要，保留快捷键和风险窗口；浏览器与 Desktop 继续使用已有设置侧栏分组。

## statusline

原有命令和默认输出保持兼容，新增选项可组合使用：

```sh
quotern statusline --preset compact --quota --reset
quotern statusline --preset detailed --quota --account claude@work --reset --color
quotern statusline --preview --preset compact --quota --account claude@work --reset --lang zh-CN
```

`--account` 为额度快照中的 provider ID，例如 `claude`、`claude@profile-12345678` 或 `codex`，显示为「监测账号」，不宣称与宿主当前登录相同。未指定时读取 `claude` 槽位；不存在时显示未知。`--quota` / `--reset` 只读取本地 runtime 快照，旧值标明陈旧，重置/到期时间分别表达；不会发起额度刷新或模型请求。`--color` 显式启用 ANSI 颜色，并遵守 `NO_COLOR`。`--preview` 使用合成数据，不等待 stdin 或写入状态。

## 实现边界与验证

账号提醒保存在额度偏好的 `accountAlerts`，键为 provider 与已验证的匿名账号引用。活动只保留项目名、工具名、状态和时间，不保留提示词、工具输入或工具输出；最近索引最多 512 个会话，接口最多返回 32 条、一天内观测。前端仅在列表打开时轮询，页面隐藏时暂停。

活动入口复用本机 HTTP / Desktop IPC，校验 Host、Origin 和连接来源；演示中不注册。Claude 工具事件按 [官方 hooks 契约](https://code.claude.com/docs/en/hooks) 读取。真实 Agent/原生通知送达与 macOS/Linux 终端需对应环境验收。

自动化入口：`corepack pnpm test`、`corepack pnpm --filter quotern-desktop typecheck`；构建后 `node apps/desktop/scripts/run-account-billing-smoke.mjs` 覆盖双端合成账号/账单、提醒验证与保存失败重试、活动读取失败恢复、历史范围/比较/导航及窄屏。测试不安装真实 hooks，不调用真实账号或消费额度。
