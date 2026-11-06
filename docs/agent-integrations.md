# 可选 Agent 集成

入口为浏览器和 Desktop 的「设置 → 应用 → Agent 集成」。功能偏好保存在统计目录下 `integrations/preferences.json`，默认全部关闭；启用功能和安装 Hook 是两个独立步骤。现有采集通知 Hook 不受这些开关影响。

## 终端提示与交接

安装 Claude / Codex Hook 后，可分别启用：

- 低额度提醒：只读本机额度快照，要求新鲜、可信账号、原生来源；按会话、额度窗口及阈值去重。提醒不阻止任务、不自动换账号。
- Token Saver：在会话中请求简洁回答，保留必要代码、命令、错误和证据；没有保证节省比例。
- 新手解释：请 Agent 在正常回答中解释少量术语，没有额外模型请求。
- 项目交接：在会话详情「新会话交接」生成预览。按需读取所选会话近期请求、最后观测的未完计划和当前 Git 状态；编辑后可复制或保存。保存才写正文，启用交接的 Hook 在同目录的新会话中读取，30 天后失效。清除操作保存空内容。历史摘录不证明工作尚未完成，也不自动执行摘录中的指令。

安装器只管理生成的独立命令，保留其他 Hook 和设置；原 JSON 保存在 `integrations/backups/`。JSON 损坏时拒绝覆盖。Codex 仍需由用户在 `/hooks` 审核信任，Quotern 不设置受信任哈希。安装 Hook 不代表插件已经加载。

CLI 对应命令：

```sh
quotern agent status
quotern agent set quotaHints on
quotern agent set tokenSaver on
quotern agent install claude
quotern agent install codex
quotern agent uninstall claude
quotern agent plugin
```

`--data-dir DIR` 指定统计目录，安装命令的 `--config-dir DIR` 指定目标 Agent 配置目录。隔离开发的界面安装只写本实例 `integrations/hosts/`，不会改用户正式配置。

## Claude 侧栏与术语学习

点击「准备 Claude 插件」生成本地插件目录和 `claude --plugin-dir ...` 命令；用该命令开始新会话，再运行 `/quotern`。使用公开 Mod 接口，目标为 Claude Code 2.1.299+；`claude -p` 不绘制侧栏，组织策略可能禁用插件。该加载方式仅作用于当前会话，正常启动不带参数即不加载。

侧栏读取宿主上下文、额度和当前会话的子代理状态，并展示可选 Hook 记录的最近会话事件及时间。最近事件不是进程存活检查。关闭侧栏开关会停止展示这些观测。

术语学习独立开关。开启后，用户明确运行 `/quotern-learn`，才将最新回答的前 6,000 字符发送给 Haiku，最多解释三项术语；此请求消耗额度。五小时额度未知或已用至少 90% 时跳过。学习条目在 Claude 插件本机存储中保存，可在侧栏标记已复习；不会把解释追加成新的 Agent 任务。

接口依据：[Claude Mod API](https://code.claude.com/docs/en/plugins/mods/api)、[Mod 参考](https://code.claude.com/docs/en/plugins/mods/reference)、[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Codex Hooks](https://learn.chatgpt.com/docs/hooks)。实际运行版本生成的类型定义优先。

## 自动启动额度窗口

Claude 和 Codex 分别开关，默认关闭。此功能会执行真实短模型请求；仅支持默认账号，不遍历其他账号配置。固定提示是 `Reply with OK only. Do not use tools.`，独立空目录执行，30 秒超时、128 KiB 输出上限。

候选必须同时满足：原生成功读数、可靠账号身份、15 分钟内的观测、唯一五小时账号窗口、先前已观测的窗口结束时间、最新读数仍明确指向该结束时间且已用为零。缺失重置时间、过期读数、已开启的新窗口和有歧义的窗口都不触发。执行前再次检查当前进程的 runtime owner、开关和当前身份。Codex 通过本机 App Server 的 `config/read` 检查有效路由，只接受未自定义的 OpenAI 服务与匹配快照的文件 OAuth 身份；第三方服务、端点覆盖和不明配置跳过。Claude 使用 `auth status --json` 重新匹配订阅身份。隔离开发禁止真实请求。

`integrations/window-start.json` 在请求前记录尝试，按账号与旧窗口去重。失败、超时和结果不明不自动重试。开启开关不意味着一定会发送请求：无法证明窗口状态时保持不执行。

## 数据来源与诊断边界

Muse 历史用量来自本地 `sessions/.../session.jsonl`；额度仅调用 `muse usage --json`，保留其实际观测时间。未安装、版本不支持或无缓存时显示不可用，不退回 `muse exec`。

会话使用诊断定位可识别的重复读、生成目录扫描、大段/重复输出及高消耗会话。持久化内容为工具名、哈希、次数、体积和时间等摘要；字符数除以四仅为粗略体积估算，不是测得的浪费。跨工具关联区分明确会话 ID 和项目/时间推断，多个候选不自动关联；目标会话用量不加入父会话合计。

状态栏增强继续使用 `quotern statusline`，上下文和缓存数据优先来自宿主。可选增长采样及参数以 `quotern statusline --help` 为准。总览用量变化使用当前日期和 Agent 范围，增长对比采用紧邻等时长区间；采集覆盖不足不生成增长判断。
