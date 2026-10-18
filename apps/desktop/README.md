# quotern-desktop

Electron 桌面客户端：与 CLI 共用 `~/.quotern` 数据。主进程管理本地 API 和窗口，通常由 utilityProcess 执行 Core 采集。职责和恢复边界见[运行维护注意事项](../../docs/runtime-notes.md)。

## 当前能力

- 主进程加载配置、注册 Hook 并启动采集 worker，应用结果到 `BucketStore`；`notify.signal` 和后台轮询驱动采集，空闲轮询从 1 分钟退避到 2、5 分钟
- 共用 `~/.quotern/bin/notify.sh` 或 Windows 的 `notify.cmd` / `notify.ps1`（纯信号，不 spawn CLI）；由桌面持有 `tud.pid` 执行本地采集
- 启动时优先清掉 CLI（含 launchd / Windows 计划任务自启）并强制抢占 runtime，不再降级为 observer
- 心跳文件 `~/.quotern/tud.heartbeat`：运行中续期；runtime 挂掉会自动拉起。对端桌面心跳过期时，新实例会 kill 旧进程再启动
- `config.json` 损坏时尝试备份为 `config.json.bak.<ts>` 并重建，优先保留设备标识
- 通过 **内存 Hono local-api**（不占 :8452）经 IPC 向渲染层提供与 CLI 相同的 `/functions/tud-*` 契约
- Dashboard / 设置读同一本地 queue

## 启动

```bash
# 启动桌面端
pnpm dev:desktop

# 构建
pnpm build:desktop

# 打包 macOS / Windows
pnpm build:desktop:mac
pnpm build:desktop:win
```

## 测试

### 订阅卡片 Desktop mock 预览

先启动本地 `quota-mock-preview.mjs`，再在 worktree 根运行 `corepack pnpm dev:desktop:quota`。默认连接 `http://127.0.0.1:5173/?scene=mixed`，mock 健康接口必须声明当前 checkout；其他端口可通过当前命令环境中的 `QUOTERN_QUOTA_PREVIEW_URL` 指定本机根地址。

此入口使用真实 `DesktopWindow` 与订阅卡片，但不启动 Core 采集、订阅读取器、宠物、通知或更新服务；preload 仅提供窗口控件。浏览器 profile 位于 `.quotern-dev/electron/quota-preview`，与普通开发和正式数据分开；打包环境或非隔离启动会拒绝运行。

本次 mock 源码及场景说明位于 `C:/Users/Admin/.codex/visualizations/2026/10/16/01a1438e-e643-7760-9601-be32cca26e3e`。默认 12 张卡同时展示正常、接近上限、耗尽、登录失效、读取失败、无历史、日限额最短、最短周期采样不足及独立模型池；下拉菜单仍可统一切换场景。刷新只更新虚构读数的查询时间。

### 自动化检查

使用 Node.js 22.13+（测试会加载 `node:sqlite`），先在仓库根安装依赖并构建 Core：

```bash
pnpm --filter quotern-core build
pnpm --filter quotern-desktop test
```

测试命令会先清理旧的 `dist-test`，编译 `src/**/*.test.ts`，再执行 `dist-test/**/*.test.js`；新增测试无需维护文件列表。

## 与 CLI 的关系

| | CLI (`quotern start`) | Desktop |
|--|--|--|
| 数据目录 | `~/.quotern` | 同左 |
| Hook | 同一组平台信号脚本 | 同左（启动时自动注册） |
| 读数方式 | HTTP `:8452` | 主进程 Core + IPC |
| Sync / poll | owner 时有；遇桌面 owner 则观察模式 | 启动即 owner：先停 CLI 再独占 sync |

同一时刻只有一个常驻 owner 通过 `tud.pid`（JSON：`{pid,kind}`，`kind` 为 `cli` | `desktop`）调度本地采集。打开桌面端会停止 CLI 并接管；macOS / Windows 同时撤销对应的 CLI 自启，Linux 尚无该撤销分支。之后若再手动 `quotern start`，CLI 只开面板读数（观察模式），不创建常驻采集调度。

## 技术栈

- electron 35.4.0（Node 22.15，主进程可用 `node:sqlite`）+ electron-vite ^5（Vite 6）
- React 19 + TanStack Router（与 quotern-dashboard 一致）
- Tailwind CSS v4 + HeroUI v3
- electron-builder（macOS + Windows）

## 目录

```
apps/desktop/
├── electron.vite.config.ts
├── electron-builder.yml
├── src/main/
│   ├── index.ts            # 生命周期 + 启动 local runtime
│   ├── local-runtime.ts    # quotern-core 运行时（无 HTTP 端口）
│   ├── sync-worker-host.ts # utilityProcess 宿主与恢复
│   ├── sync-worker.ts      # 采集任务与独立 watchdog
│   ├── local-api-ipc.ts    # IPC → 内存 local-api
│   └── DesktopWindow.ts
├── src/preload/index.ts    # window.tud（窗口控制 + api.request）
└── src/renderer/           # 与 dashboard 同构 UI
```

## 数据层

- Renderer 的 `api.ts`：存在 `window.tud.api` 时用 IPC，否则回退 `fetch`（兼容非 Electron 场景）

### Copilot 套餐额度

主面板和托盘的订阅区显示 Copilot 套餐剩余额度、内联建议及重置时间，设置中的「订阅额度卡片」可控制显示。套餐额度独立于 Core 采集的 Copilot Token 用量。

主进程读取 Copilot 官方客户端保存的 `github-copilot/apps.json` / `hosts.json` 中的 OAuth 登录信息；macOS / Linux 默认位于 `~/.config/`，Windows 位于 `%USERPROFILE%\AppData\Local\`，也支持绝对路径 `XDG_CONFIG_HOME`。显式设置的 `GH_COPILOT_TOKEN` / `GITHUB_COPILOT_TOKEN` 优先。凭证仅在主进程使用，IPC 只返回套餐和额度。

存在多个账号时，根据 VS Code `state.vscdb` 的 Copilot 账号记录匹配，无法明确匹配时隐藏卡片，避免展示其他账号余额；自定义 VS Code 数据位置可设置 `VSCODE_STATE_DB_PATH`。仅有 VS Code 加密登录、没有上述可读取的 Copilot 登录信息时，暂不展示额度，不读取系统钥匙串。

额度来自 [VS Code 使用的内部接口](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/chat/common/chatEntitlementService.ts)，成功读数缓存 60 秒，窗口聚焦时刷新。网络异常保留同一账号的最近读数并标为「旧」；账号切换、退出或认证失效后清除旧读数。内部接口变化可能影响可用性。

### Kimi 桌面版与 Kimi Code

订阅区统一显示一张「Kimi」卡片，桌面版和 Code 仅作为底层独立读取来源。优先使用新鲜、带有效额度与套餐名的完整读数；Code 同时提供月度共享额度和滚动限额时可在同一卡片展示，其他情况下优先使用确认的共享额度。一端没有登录或读取失败时，可使用另一端的有效读数；不会拼接不同来源的套餐与额度，也不会把共享池相加。

只登录 Code 时无需打开或登录桌面版。Code 使用官方 `/me` 返回的套餐名（包括 Free、Go、Plus、Pro、Max 及未知新名称），使用 `/usages` 返回的 5 小时、周限额及可选月度共享额度；缺失字段不补零，`limit_month_code` 是月度用量构成，不与共享总量相加。两端缓存和账号切换仍独立；付费套餐首次读取失败、没有有效读数时隐藏卡片，窗口再次聚焦后自动重试。已成功读取的同账号数据可在网络异常时保留并标为「旧」，已确认的 Free 套餐信息、登录或配置异常仍可展示提示并重试。

桌面版数据默认位于 macOS 的 `~/Library/Application Support/kimi-desktop`、Windows 的 `%APPDATA%/kimi-desktop`、Linux 的 `$XDG_CONFIG_HOME/kimi-desktop`（未设置时为 `~/.config/kimi-desktop`），可用 `KIMI_DESKTOP_HOME` 覆盖。支持 `daimon-storage.json` 中的绝对 `shareDir` 迁移路径。

桌面来源的订阅读取需要 Kimi 桌面版正在运行且已登录，通过它的本地 Context IPC 获取当前账号和有效令牌（续期由 Kimi 自身处理），不读取可能在退出后残留的磁盘令牌、不访问系统钥匙串。令牌仅在主进程内存中使用，会员请求只发送到当前账号所属的官方区域（`www.kimi.com` / `www.kimi.ai`）。Code 凭证只访问相应官方区域的 `api.kimi.com/coding/v1` 或 `api.kimi.ai/coding/v1`，不发送到桌面会员接口。缓存按账号、来源和区域隔离，发布读数前再次验证当前账号；退出或认证失效后清除旧额度。

macOS/Linux 自动发现当前用户的私有 Context socket，已退出进程遗留的失效 socket 不影响 Code 读取；Windows 暂需通过 `KIMI_WORK_CONTEXT_IPC` 指定 Kimi 的 Context 命名管道。无法取得当前账号时显示打开 Kimi 的提示，仍可扫描历史用量。该桌面接口为内部接口，已在 macOS Kimi 3.2.15 验证，后续客户端变化可能需要更新适配；Windows/Linux 尚未实机验证。

本地 Token 与项目统计独立读取 `daimon-share/daimon/runtime/kimi-code/home` 中的 `session_index.jsonl` 和 `sessions/**/wire.jsonl`，复用 Kimi Code 的增量解析并去重。上下文占用快照不作为累计消耗；CLI 和 Desktop 均支持该数据源，常驻采集遵循 owner 规则。内部模型别名没有公开价格时使用估算兜底，不等同于会员账单。

## 窗口外观

- macOS：隐藏标题栏，保留红绿灯
- Windows / Linux：无边框
- `window.tud`：最小化 / 最大化 / 关闭 + `api.request` / `onDataSynced`

## Windows 桌面宠物

在「设置 → 应用 → 桌面宠物」开启，也可用 Windows 托盘菜单的「显示/隐藏桌面宠物」。角色、大小、Bot 颜色和位置保存在 Desktop 的 userData 中；默认不显示。内置 Clawd、Bot、Sprout、Byte、Ember，支持导入标准宠物 ZIP、已安装的 Codex 宠物，以及 codex-pets.net 的宠物地址或 ID。移除内置图集角色只是隐藏，可在设置中恢复。

宠物使用同一份本机用量和订阅额度，后台、主窗口或宠物菜单发起同步时都会显示工作状态。悬浮窗支持点击切换表情与短句、右键菜单开关主窗口、拖动及随方向切换跑动、右侧贴边和 200ms 滑动展开；双击按两次普通点击处理，精灵外区域透传鼠标。窗口不监听全局按键活动，也不读取按键内容。隐藏后停止鼠标位置轮询；系统减少动态效果时暂停精灵逐帧动画。

Windows 实机验收建议：

1. 用隔离开发入口 `pnpm dev:desktop` 启动，打开设置的「应用」页，开启宠物，依次切换五个内置角色、大小、Bot 颜色及预览动作。
2. 悬停确认用量气泡和订阅额度；单击观察短句与表情，双击确认不会打开主面板，右键检查菜单；在精灵外空白区域点击底下的窗口，确认鼠标透传。
3. 拖过约 10 像素确认移动，拖动途中反向确认跑动方向切换；拖到屏幕右缘确认贴边，从屏幕边缘缓慢移向角色时保持展开、气泡完整显示，移出后滑动收起。在多显示器间拖动，变更分辨率或断开副屏后确认仍能找回宠物。
4. 隐藏后重新显示、退出并重启 Desktop，确认角色、大小、位置及贴边状态保留。再导入一个合法 ZIP 或 Codex 宠物，检查 V1/V2 图集与移除、恢复操作。
5. 分别从主窗口、宠物右键菜单触发同步，并等待一次后台自动同步，确认同步期间切换到工作动作、完成后恢复。

## 待统一规划

- 顶层菜单与窗口拖拽区域
- Windows 代码签名；macOS 打包已启用 hardened runtime 和 notarize，发版前需配置有效身份与凭据

## 自动更新发布

正式安装包使用 `electron-updater` 从
[GitHub Releases](https://github.com/yuhengqin/Quotern/releases)
检查更新和下载安装包。`electron-builder.yml` 是发布与更新目标的统一配置来源；构建时生成的 `app-update.yml` 随应用打包。
当前配置支持私有仓库：客户端需通过 `GH_TOKEN`（或 `GITHUB_TOKEN`）提供具有仓库读取权限的凭据。凭据由客户端环境提供，不写入源码或安装包。未提供凭据时只能读取公开 Release；网页下载页的匿名查询失败后会引导到 GitHub Release 页面登录下载。
应用启动后立即检查一次，之后每 6 小时检查；yml 的 `version` 用 semver 与已装版本比较，
**只有远程更高才更新**（相等或更低忽略，禁止降级）。正式安装版发现新版本后自动下载。Windows portable 只提示新版本并引导手动下载便携包，不下载或安装 NSIS 更新。
顶部工具栏和设置中展示下载进度，下载完成即自动停止本地 runtime、放开
主窗口和托盘气泡的关窗拦截，再重启并安装。新版本首次启动时会通过 Toast 提示更新完成。开发模式不会访问更新服务。
如果重启安装未在限定时间内完成，应用会恢复本地 runtime 和关到托盘行为，重新打开主窗口，并在
顶部工具栏和设置的“应用更新”区域提供“更新并重启”按钮，点击一次即可重试，无需重新下载。设置中不再额外显示“自动重启未完成”提示卡片。
更新检查在 runtime 和窗口初始化完成后启动，避免缓存更新与启动流程竞争。退出被取消时保留更新 watchdog 和 IPC；停止 runtime 超时不会让按钮一直等待，也不会让旧尝试的迟到结果触发新一轮安装。
设置中的“检查更新”始终显示在“应用更新”标题右侧，发现更新后在旁边显示与顶部工具栏一致的下载进度或重启按钮，不再另起进度条和下载说明。无新版本时不显示额外提示，更新期间单独显示“最新版本”一行，与“当前版本”的标签和版本号使用相同字体、字号和左右对齐方式；错误提示仍正常显示。

发版前先提高 `apps/desktop/package.json` 的 `version`。版本包含预发布段（例如
`0.1.1-beta.8`）时进入预发布更新通道；稳定版本使用普通 Release。

私有仓库预发布更新存在依赖限制：当前 `electron-updater` 6.8.9 会优先选择列表中的预发布 Release，即使正式版版本更高。beta 客户端可能因此错过正式版升级；发布时需单独验收这一路径，受影响用户可从 Release 页面手动安装正式版。正式版客户端只读取正式 Release。

设置具备 GitHub Releases 写权限的 `GH_TOKEN` 后，在对应系统执行：

```bash
# macOS：构建、签名、公证并上传 dmg/zip、blockmap 和 latest-mac.yml
pnpm release:desktop:mac

# Windows：构建并上传 NSIS/portable、blockmap 和 latest.yml
pnpm release:desktop:win
```

`electron-builder.yml` 的 `publish` 指向 `yuhengqin/Quotern`。上述命令将
dmg/zip/exe、blockmap 和对应平台、通道的更新 yml 上传到 GitHub Release；客户端直接读取这些 Release 附件。
无需在源码仓库维护 `releases/*.yml`。发布前核对更新清单的版本、文件大小和 SHA-512 校验和与实际附件一致。

两个平台可以向同一个版本的 GitHub Release 追加产物。GitHub Release 上的安装包及
`.blockmap` 和更新 yml 需要保留，保证已发布版本仍能正常下载与更新。
electron-builder 默认先创建 Draft；两个平台上传并验收完成后，再到 GitHub 将 Draft
发布。beta 版本应勾选为 Pre-release，稳定版本发布为普通 Release，避免客户端看到
产物不完整的版本。
发布 Windows 安装版自动更新前应补齐代码签名；便携版用户手动下载 portable 包，安装版更新使用 NSIS 产物。

## 已知环境差异

### Electron 二进制下载

本仓库通过根 `package.json` 的 `pnpm.onlyBuiltDependencies` 允许 Electron 安装脚本；`apps/desktop/.npmrc`
进一步允许 pre/post scripts。

`apps/desktop/.npmrc` 已配置国内镜像（`electron_mirror` /
`electron_builder_binaries_mirror`）。若仍下载失败，可临时覆盖：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
pnpm dev:desktop
```

## Codex / Claude 订阅额度

桌面端从本机登录状态读取订阅额度：

- Codex 从 `CODEX_HOME/auth.json`（默认 `~/.codex/auth.json`）只读获取 ChatGPT 登录凭据，请求 `/backend-api/wham/usage`，无需安装或启动 Codex CLI。不会刷新令牌或改写登录文件；令牌失效时提示重新登录。
- Claude 使用本机 Claude Code 的 `-p /usage --output-format json`；在临时目录运行，关闭工具、MCP、用户/项目 settings 和会话保存，应用不读取 Keychain 或调用 Anthropic OAuth usage 接口。官方账户校验仍排除自定义 provider。
- 这两个订阅来源的读数由主窗口与托盘共享，使用一分钟内存缓存并合并并发请求；账号改变或认证失效时不沿用旧额度。临时失败可显示同账号上次额度和旧数据标记。
- 有登录记录但读取失败时保留卡片并展示原因；没有登录记录时隐藏对应的订阅额度卡片。

上面的身份缓存规则针对 Codex / Claude。其他订阅来源的字段、缓存和失败处理存在差异，详见[订阅数据说明](../../docs/subscription-plan-design.md)。

界面通过主进程额度管理器消费各 reader：动态窗口可展开，支持接近上限与恢复提醒、三种参考节奏、六小时趋势和满足条件时的耗尽估算。设置与九十天历史保存在 Desktop userData 中，关闭通道同时停止其后台读取和提醒。Windows 与 macOS 点击托盘图标均可打开概览；公开服务状态与账号错误分别展示。具体阈值、刷新策略、数据隔离和限制见 [Desktop 额度管理](../../docs/quota-management.md)。
