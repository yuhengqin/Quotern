# Quotern CLI 使用说明

需要 Node.js >= 20。

## 安装

```bash
npm i -g quotern
```

国内网络较慢时，可使用镜像源：

```bash
npm i -g quotern --registry=https://registry.npmmirror.com/
```

也可免安装直接用 `npx`：

```bash
# 后台常驻（推荐，支持开机自启）
npx quotern service start

# 前台运行（当前终端占用，方便看日志，Ctrl+C 停止）
npx quotern start

# 面板: http://127.0.0.1:8252
```

## 快速开始

推荐用后台服务启动（常驻，支持开机自启，macOS / Windows / Linux）：

```bash
quotern service start
# 面板: http://127.0.0.1:8252
```

Linux 后台服务依赖 systemd 用户实例（`systemctl --user`）。无 systemd 时改用 `quotern start` 前台运行。

Windows 注册开机自启需要管理员权限：建议在「以管理员身份运行」的终端中执行 `quotern service start`。首次注册失败会导致命令失败，可改用 `quotern start` 前台运行；已有服务运行时补注册失败只警告，不影响该服务。

首次启动会写入数据目录 `~/.quotern/`，尝试注册 Claude / Codex Hook，并同步本地用量。

常用管理：

```bash
quotern service status
quotern service stop
quotern status
```

需要前台运行（当前终端占用、方便看日志）时再用：

```bash
quotern start
# Ctrl+C 停止
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `quotern service <action>` | **推荐** 后台服务与开机自启；`action`: `start` \| `stop` \| `status` |
| `quotern` / `quotern start` | 前台启动本地面板与同步 |
| `quotern stop` | 停止当前进程内的前台服务 |
| `quotern status` | 查看 CLI / 面板当前状态 |
| `quotern sync` | 手动同步本地用量数据 |
| `quotern doctor` | 检查运行环境、本地数据源及服务状态 |
| `quotern usage [period]` | 只读查询已采集用量，支持文本、JSON、CSV |
| `quotern statusline` | 从 Claude stdin 显示会话费用、今日估价、上下文和会话平均费用速率 |
| `quotern demo export --out <文件>` | 将已采集数据匿名化导出为独立演示快照 |
| `quotern demo start --file <文件>` | 只读运行演示快照，默认端口 8253 |
| `quotern quota [status\|forecast\|diagnostics]` | 只读查询额度、预测或安全来源诊断，支持 JSON |
| `quotern quota recommend` / `quotern quota providers` | 只读账号建议 / 版本化渠道描述 |
| `quotern prompt` | 通用终端单行额度摘要，只读缓存 |
| `quotern mcp` | stdio MCP，提供四个只读额度工具 |
| `quotern help` | 显示帮助 |

## 常用选项

```bash
quotern start --port 8252
quotern start --host 0.0.0.0          # 局域网可访问；默认 127.0.0.1
quotern sync --source=claude          # claude | codex | cursor | all
```

默认端口为 `8252`。已有 `~/.quotern/config.json` 中的 `serverPort` 会继续生效；显式 `--port` 优先于已保存配置。需要切换已有实例时，先退出前台实例或运行 `quotern service stop`，再执行 `quotern start --port 8252` 或 `quotern service start --port 8252`，新端口会保存到配置中。

## 用量报表与 Agent 查询

```bash
quotern usage                         # 最近 7 天，包含今天
quotern usage overview --days 7 --json --compact # 同次读取的综合概览
quotern usage daily --days 30
quotern usage weekly --from 2026-06-01 --to 2026-06-30
quotern usage monthly --days 90 --csv
quotern usage models --source codex,claude --days 30 --json
quotern usage projects --project Quotern --days 30 --format json
```

`period` 支持 `summary`（命令行默认）、`overview`、`daily`、`weekly`、`monthly`、`models`、`projects`。日期以 `Asia/Shanghai` 划分，包含起止日，周一为一周起点。`--days` 接受 1–3660；与成对的 `--from/--to` 互斥。筛选支持逗号分隔的 `--source`、完整模型名 `--model` 和项目显示名 `--project`。同名项目目录沿用面板合并口径；模型仍保留 Agent 身份。

命令直接读取本地配置、统计队列和已有价格缓存，Desktop 运行时也可使用；不会启动服务、同步原始日志或扩大采集范围。默认目录为 `~/.quotern/`，`--data-dir <目录>` 可显式选择已有数据。缺配置或非法参数退出码为 1；空结果正常返回。数据为读取时已落盘的快照，同步正在进行时与面板读数可能有短暂差异。

JSON 使用 `schemaVersion: 1`，包含 `summary`、`rows`、`filters` 和 `coverage`。先检查采集起点、`limited`、最近同步时间；请求的日期范围早于采集起点时，结果不代表完整历史。费用的 `costUsd: null` 表示部分价格未知，`knownCostUsd` 仅为已计价小计；CSV 对未知费用/请求数/缓存率留空。`costExplanation` 提供来源报告金额、按费率估算、默认费率占比、缺失价格、实际匹配模型和 Token 依据。费用均不能直接解释为实际付款。

`overview` 额外返回 `breakdowns.daily`、`breakdowns.models`、`breakdowns.projects`：同一次读取后筛选的记录生成全部维度，共用顶层范围、筛选和覆盖说明，不能将不同维度相加。`rows` 保留总计行；CSV 的 `period` 列分别标识 `summary/daily/models/projects`。Skill 将“查看用量信息”等宽泛请求默认交付为 Quotern 样式的综合 HTML 概览；明确的单项查询仍按问题简洁回答。

Agent 可使用随 npm 包分发的 [quotern-usage Skill](./packages/cli/skills/quotern-usage/SKILL.md)。推荐通过 `npx skills` 跨工具安装，见 [安装方法](./README.md#推荐使用-npx-skills-安装)；也可让 Agent 按 [安装助手说明](./README_AI.md) 执行。手动复制完整 Skill 文件夹作为备用。Skill 只调用上述 JSON 查询，不维护第二套解析器，也不会隐式启动或修复服务。

## 额度查询与只读 MCP

```bash
quotern quota --json
quotern quota status --provider gemini --runtime desktop
quotern quota diagnostics --provider codex --json
quotern quota forecast --runtime cli --data-dir /path/to/data --json
quotern quota --refresh --port 8252 --provider codex --json
```

默认只读 `<data-dir>/quota-snapshots/cli.json` 与 `desktop.json`，不初始化采集服务、不读取凭据、不修复配置、不联网。`--runtime latest` 为默认值，选择生成时间最新的一个有效快照，不拼接两端读数；也可固定为 `cli` 或 `desktop`。Desktop 不需要启动 HTTP 服务即可供查询。服务需要升级到支持快照的版本并完成至少一次额度查询，才会出现这些文件。快照只包含启用的渠道，`--provider` 按渠道筛选，包括该渠道已配置的监控目录。

`--refresh` 是显式例外：通过 loopback POST 请求**已运行的 CLI** 刷新，可能调用供应商接口或现有 Agent CLI，不启动新服务。端口优先使用 `--port`，其次现有 config 的 `serverPort`，否则为 8252；服务端校验数据目录摘要，拒绝刷新另一个数据目录。仅有 Desktop 时请在 Desktop 内刷新，`--runtime desktop --refresh` 会报错。不要将目录摘要当作身份认证机制。

JSON 使用 `schemaVersion: 1`，`generatedAt` 为发布时刻、`readAt` 为读取时刻，时间戳均为 Unix 秒。先检查 `availability`（`ready/missing/invalid`）、`stale`、provider 状态与观察时间；文件缺失/损坏不会变成额度 0，正常返回结构化未知结果。参数错误或显式刷新失败退出码为 1。快照与 provider 观察超过 30 分钟标记陈旧；窗口经过重置时刻后单独标记陈旧。陈旧窗口不返回预测，`forecast: null` 不代表额度充足。诊断只包含固定阶段、错误码、HTTP 状态、耗时、查询/退避时间和缓存/OMP 回退标记，不包含原始错误、邮箱、认证信息或监控目录。

百分比窗口的 `kind` 为 `percentage`；余额窗口为 `balance`，`usedPercent: null`，通过 `balance.currency/remaining` 表达金额，真实零余额保留为 0。无限或已耗尽的非百分比池放在 `providers[].details` 的 `valueKind` 中。公开报告不透传供应商自由文本或配置备注。

启动 MCP：

```bash
quotern mcp --runtime latest
```

在支持 stdio MCP 的客户端中，启动命令设为已安装的 `quotern`，参数为 `mcp`；需要时追加 `--data-dir` 和 `--runtime`。例如支持 `mcpServers` 格式的客户端可合入：

```json
{
  "mcpServers": {
    "quotern-quota": {
      "command": "quotern",
      "args": ["mcp", "--runtime", "latest"]
    }
  }
}
```

状态工具为 `quota_status`、`quota_forecast`、`quota_diagnostics`，参数接受可选的 `provider`，如 `{"provider":"gemini"}`。另有 `quota_recommend`，要求 `provider`，可选互斥的 `model` / `feature`（精确上游分组标识）。所有工具拒绝任意文件路径、刷新及设置参数。结果同时提供 JSON 文本和 `structuredContent`，stdout 只承载 MCP 消息；stdin EOF、SIGINT/SIGTERM 会关闭服务。

Gemini CLI 的认证和内部 API 限制见 [订阅数据说明](docs/subscription-plan-design.md#gemini-cli)。

### 账号建议、渠道描述与终端摘要

```bash
quotern quota recommend --provider claude --model opus --json
quotern quota recommend --provider codex --feature EXACT_UPSTREAM_POOL --json
quotern quota providers --json
quotern prompt --provider codex --runtime desktop
```

推荐只使用新鲜、读取成功且身份已验证的原生监控账号，按已知受影响池中最小剩余比例排序，返回候选、固定原因和各池重置时间。Claude `model` 使用实际返回的分组（如 `opus`），Codex `feature` 使用接口实际返回的功能标识；不猜具体模型版本的池归属。指定目标时仍检查共享池，其他模型池不参与。省略目标只检查共享账号池，不表示任意模型均可用；缺必要证据返回 `unknown`，已知池耗尽返回 `blocked`。OMP 观察不是可切换账号候选。建议不会登录、修改凭据、切换供应商 CLI，也不保证请求成功。

Claude 推荐要求同时观察到五小时和共享周额度；单个窗口仍可展示，但不足以推荐。Codex 保留上游单共享窗口的情况，指定功能时检查该功能的全部已知周期，不要求功能周期与账号周期相同。

新版快照仅用已有 provider ID 表达本次快照内重复账号的引用，不导出身份哈希、备注或目录。旧快照缺该引用时不推荐；请在原 Quotern runtime 刷新一次。`recommend` 与 `providers` 不接受 `--refresh`。

`prompt` 不读取 stdin、不联网、不写数据或初始化后台采样，输出最多 512 字符的一行纯文本（无 ANSI），保留真实零值、未知与陈旧状态。默认最多显示三个来源；`--provider` 选择一个。它有独立轻量入口，避免加载服务与日志解析器。现有 Claude `statusline` 保留原有 stdin 行为。

PowerShell 可在自己的提示符函数中调用；Quotern 不自动修改 `$PROFILE`。例如：

```powershell
function prompt {
  $quotaHint = & quotern prompt --provider codex
  "$quotaHint`nPS $($executionContext.SessionState.Path.CurrentLocation)> "
}
```

可自行按 30–60 秒缓存上述短句，减少重复启动进程。

## Claude statusline

将下面的配置合入 Claude Code 的用户或项目设置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "quotern statusline"
  }
}
```

需要 `quotern` 已安装并可从 Claude 启动的 shell 找到；也可将 command 换成已安装 CLI 的绝对路径。支持 `--lang zh-CN|en|ja|ko` 和 `--data-dir <已有数据目录>`。配置格式见 [Claude Code 官方文档](https://code.claude.com/docs/en/statusline)。

会话费用和当前上下文优先使用 Claude 通过 stdin 传来的数值；今日费用只读本地 Claude 统计，并显示最近同步时刻。费用未知时显示未知，部分价格缺失时显示已知小计；会话均速为宿主会话金额除以已运行时长，不是生成速度或订阅额度消耗率。宿主金额也是参考价估算，不能当作付款账单。命令不会启动服务、联网、同步或改写 Claude 设置，空/坏输入也只输出一行未知读数。

## 演示快照与只读面板

使用当前源码构建 CLI 后，可将已采集历史导出为单个匿名化 JSON，再在同一台机器或另一台没有 Agent 的机器展示：

```bash
corepack pnpm build:cli
node packages/cli/bin/quotern.js demo export --out ./demo/quotern-demo.json
node packages/cli/bin/quotern.js demo start --file ./demo/quotern-demo.json
# 默认 http://127.0.0.1:8253；Ctrl+C 只停止这个演示进程
```

安装了包含此功能的 CLI 时，对应命令为 `quotern demo export` / `quotern demo start`；`quotern demo --help` 查看参数。

- 导出默认只读当前 Quotern 数据目录；`--data-dir <source>` 可显式选择另一份已采集数据。不会同步、修复配置、抢占运行实例、注册 Hook 或读取原始对话日志。正常客户端可以继续运行；遇到输入文件持续变化会拒绝导出，稍后重试即可。
- `--out` 必填，不覆盖已有文件，也不允许输出到源数据目录内。快照按字段白名单保留统计、时间、数值证据、会话与成就、两层生效价格；项目/会话标题使用演示名称，身份和关联标识每次独立匿名化。游标、原始路径、聊天正文、登录凭据、用户图片与任意未知字段不导出。仍保留真实用量、时间、Agent、模型和计费证据；它是历史使用情况的演示副本。
- `--file` 必填；演示启动不会回退正常目录。数据完全在内存读取，不创建 `tud.pid`、Hook、采集游标、日志、额度管理器或聚合缓存。默认单独使用 8253，可用 `--port <number>` 和 `--host <address>` 指定监听；端口冲突时退出，不停止占用者。
- 所有写请求返回 HTTP 403 / `DEMO_READ_ONLY`。日期与相对时间冻结在快照最新数据的参考时间；事件真实时间不平移。筛选、搜索、会话详情、成就浏览、价格比较及内置分享卡下载保留。采集、在线额度、成就修改、服务器背景图库管理关闭，浏览器偏好使用演示专属命名空间。
- 快照是当前持久化文件的稳定读取结果，不补采缺失历史，也不是跨原始 Agent 日志的事务或付款账单。使用同一份快照更新演示时，退出演示并用新文件重启。云端部署及公网访问控制另行配置，本命令不自动发布。

## 数据与同步

- 数据目录：`~/.quotern/`
- 更名后沿用已有统计与设备身份；注册或停止后台服务时会清理旧名称的自启项。
- Claude / Codex：Hook 写入信号，由常驻进程调度同步；另有后台轮询补充
- Cursor：轮询模式（无 Hook）
- 本机用量保存在本地统计队列。

调试日志：`~/.quotern/logs/notify.log`、`~/.quotern/logs/sync.log`。

采集范围、增量规则与后台恢复见[运行维护注意事项](./docs/runtime-notes.md)。
