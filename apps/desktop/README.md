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

### Windows 安装包与架构

`corepack pnpm build:desktop:win` 一次构建 x64 和 ARM64 的安装版、便携版，输出到 `apps/desktop/release/<version>/`；`corepack pnpm release:desktop:win` 构建相同产物并验证清单。所有打包命令使用 `--publish never`，不上传 GitHub Release。

| 架构 | 安装版 | 便携版 |
| --- | --- | --- |
| x64 | `Quotern-<version>-win-x64-setup.exe` | `Quotern-<version>-win-x64-portable.exe` |
| ARM64 | `Quotern-<version>-win-arm64-setup.exe` | `Quotern-<version>-win-arm64-portable.exe` |

安装版和便携版都显式带架构与类型，避免汇总到同一 Release 时重名。两种 target 分别设置 `buildUniversalInstaller: false`，使用 electron-builder 26 生成独立架构产物。安装版各自生成 `.blockmap`，同一次双架构构建生成的 `latest.yml` 同时包含两个安装版；便携版不进入自动更新清单。不要分别执行两次单架构发布并覆盖同一个 `latest.yml`。

客户端在同步的 `update-available` 回调内按运行架构筛选安装版，然后由更新库下载；私有 GitHub 的附件 API URL 不带 `.exe` 后缀，不能依赖该 URL 的默认选包规则。缺少目标架构时拒绝下载其他架构，旧未标注架构的安装清单继续兼容。

发版验收需检查四个 EXE 齐全、文件名唯一、两份安装版 blockmap 和更新清单中的文件大小及 SHA-512 一致，并确认两份解包目录的 Electron、Sharp 原生模块与 DLL 架构分别为 x64 / ARM64。交叉打包成功不等于 ARM64 实机运行验收。

### macOS 分架构产物

保留 ARM64 / x64 分包，每种架构输出 `Quotern-<version>-mac-<arch>.dmg` 和同名 `.zip`。`corepack pnpm build:desktop:mac` / `release:desktop:mac` 默认在 macOS 以 `adhoc` 模式构建并验证，不需要 Apple 会员或凭据；输出到 `release/<version>/mac-adhoc/`，内部应用和原生代码用 ad-hoc 签名，跳过公证，ZIP 仅供手动下载安装。包内标记决定手动更新行为，运行时环境变量不会覆盖它。

`corepack pnpm build:desktop:mac:signed` / `release:desktop:mac:signed` 保留 Developer ID / Team ID、hardened runtime、Gatekeeper、公证装订和自动更新验收，输出到 `release/<version>/mac-signed/`。两种模式均检查原应用、ZIP 内应用、只读挂载 DMG 内应用的签名、包内模式、版本及 Electron / Sharp 原生库架构，执行 DMG 完整性检查，生成明确标注模式的 `macos-verification.json` 和 `mac-artifacts.json`。仅 signed 模式在装订后重建 macOS blockmap / 更新清单；adhoc 模式拒绝这些自动更新文件。凭据、统一流程及实机验收边界见 [发布规范](../../RELEASE.md#desktop-统一构建与验收)；无密钥源码构建见 [CONTRIBUTING](../../CONTRIBUTING.md#从-source-code-归档构建)。

### Windows 安装向导

NSIS 安装包提供安装范围、安装目录和桌面快捷方式选项。首次安装默认选择「当前用户」；默认目录为 Windows 当前用户的程序目录（通常是 `%LOCALAPPDATA%\Programs\Quotern`），选择「所有用户」后默认为 `%ProgramFiles%\Quotern`，需要管理员权限。用户可以修改目录；升级优先沿用原安装范围与目录。

「创建桌面快捷方式」默认勾选，可取消；完成页的「运行 Quotern」默认勾选，点击完成后启动应用。自动更新不显示自定义快捷方式选项，不重新创建用户已删除的图标。开始菜单快捷方式和卸载入口继续由 electron-builder 管理。

安装器支持英语、简体中文、日语、韩语，语言选择框默认匹配系统语言，其他语言回退英语。安装器语言与应用设置中的语言偏好独立；`nsis.installerLanguages` 控制安装器翻译，`win.electronLanguages` 控制 Electron 运行时语言资源。便携版不经过安装向导。

安装器配置位于 `electron-builder.yml`，桌面快捷方式选项页通过 `scripts/installer.nsh` 扩展默认 NSIS 模板；修改时保留既有 `guid`，以识别旧安装。验证应覆盖四语言、两种安装范围、修改目录、快捷方式勾选/取消及安装后启动；自动更新还需检查原目录与已删除图标的保留。

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

### 独立桌宠托盘与漫游

Windows 主托盘仅保留一个「独立桌宠」复选项，控制唯一桌宠及其后台任务。关闭会停止 helper 与后台任务，再次启用会恢复同一只宠物；历史网页显示位保留。原有桌面宠物有独立开关。

独立桌宠运行层只提供一个实例。首次兼容旧配置时优先保留第一只显示在桌面的宠物，否则使用配置中的第一只；选择随偏好持久化，隐藏与重启不会切换到其他历史实例。旧配置和 pet pack 不删除；其他实例不渲染、不接收手动动作。设置页保留单只宠物编辑，移除添加/删除、目标实例选择与多宠物碰撞。

「锁定在当前屏幕」同时约束漫游与抛掷；关闭时仍可跨屏。漫游修复通过构建补丁接入，vendor 快照保持原样。来源见 [PATCHES.md](vendor/dsh-pet/PATCHES.md)。

`scripts/prepare-dsh-pet.test.mjs` 在生成后的精灵与共享几何上验证锁屏、跨屏、屏幕空洞和转向方向。`scripts/dsh-pet-tray-smoke.ts` 可打包为 Electron 入口，传入 runtime、全新输出目录和 Desktop 应用路径，验证真实原生菜单回调停止/恢复唯一 helper；不启动正常采集或读取正式配置。

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

- macOS：`titleBarStyle: 'hidden'`，保留原生红绿灯并垂直居中于 32px 标题条
- Windows：`titleBarStyle: 'hidden'` + 原生 Window Controls Overlay；三键由系统绘制，保留 Snap Layouts、双击最大化与标题栏系统菜单，overlay 颜色随主题同步
- Linux：无边框，渲染层自绘窗控（46×32，Win11 关闭色 `#C42B1C` / `#B22A1E`，最大化后显示双叠方框还原图标，键盘焦点可见）
- 标题条高度由 `shared/window-chrome.ts` 的 `TITLEBAR_HEIGHT` 统一驱动：主进程 overlay 高度与渲染层 CSS 变量同源
- `window.tud`：最小化 / 最大化 / 关闭 + `api.request` / `onDataSynced`

## Windows 桌面宠物

### 独立 dsh-pet

Windows 设置 → 宠物 → **大肥鱼**。默认关闭，仅运行单实例；大肥鱼与图集宠物互斥，启用任意一方会自动持久关闭另一方。旧偏好若同时启用两方，启动时优先保留大肥鱼。保留上游 106 段透明视频、点击得分/粒子、动作菜单、漫游、拖拽甩抛、反弹和多屏几何。右键菜单提供动作、额度查看、复位、重载及打开 Quotern。

单击依次轮换配置的回应动作并显示本机统计短句，视频播放结束后恢复原展示。悬停显示今日用量、明确标为参考的 USD 费用，以及最多三个有效额度窗口；其余窗口可通过点击轮换查看。画面整体轻微倾斜并遵守 reduced-motion。鼠标静止满 60 秒且没有工作状态或控制占用时，宠物播放哈欠后睡眠，鼠标移动唤醒。慢速拖动至屏幕右侧外边缘可收起；悬停后以 200ms 过渡展开，离开 300ms 后收回。收起时仅露出身体边缘，不使用 mini 素材；多屏接缝不收边。位置和收边状态保存在 helper 私有目录的 `companion-position.json`，返回初始位置可清除。

保留 Q 弹、飞行抓取得分、拖拽甩抛和原动作菜单；右键菜单新增「立即同步」与「宠物设置」。

设置提供与 Clawd 角色可见高度相近的小、中、大三档，视频画布宽度分别为 160、204、264 像素；旧数字尺寸在运行时归到最近档位。初始角落及水平、垂直偏移不再提供表单选项，仍可拖拽宠物调整位置。

配置位于 Electron `userData/dsh-pet/`，开发模式在本 worktree `.quotern-dev/electron/dsh-pet/`。设置的“打开独立目录”可定位；配置支持动作、物理、字体、额度来源和工作状态。历史模型设置及记忆文件保留在磁盘，不再使用且不会删除。种类包为 `pet/<名称>-config.json`，对应 `pet/<名称>-animation/`、`pet/<名称>-memes/`。main 覆盖素材放 `main-animation/webm/` 和 `memes/`。修改后保存配置或右键重载。高级编辑只改主配置，种类包通过目录内文件编辑。

播放回执、占用锁和位置/抛掷控制按上游 `cf3ed3c4dd6829b252f352d4c61a18db6fdb26d4` 定向接入，原始 vendor 快照保持 `6c5f043`。接口沿用 `window.tud.dshPet.dispatch({type:'request',method,path,body})` 与 helper 的鉴权管道，不增加 HTTP 监听；`body` 为 JSON 字符串，返回 `RpcResponse`，业务结果在其 JSON `body` 中。控制仅作用于当前唯一桌面实例，不接受远程素材 URL。

| 路径（省略 `/dsh-pet-7340`） | 行为 |
| --- | --- |
| `POST /anim?pet=main`，`{name,facing?}` | 播放池内动作，返回 `playbackId`；可指定 `left/right`，文字动作仍保持可读朝向 |
| `GET /playback/<id>` | 查询 `accepted/playing/ended/failed/cancelled`；`accepted` 仅表示受理，播放结果由真实 video 上报 |
| `GET /playback/<id>?wait=ended,failed,cancelled&timeout=10000` | 等待回执，wait/timeout 成对，最长 10 秒；断开与停用取消等待，终态不可被迟到报告覆盖 |
| `POST /lock?pet=main`，`{ttl?}` 或 `{lockId,ttl?}` | 占用/续期；默认 120 秒、范围 1 秒至 30 分钟，返回 `lockId/expiresAt` |
| `POST /lock/release?pet=main`，`{lockId}` | 释放；renderer 的 `{force:true}` 表示用户接管，点击/拖拽/菜单优先于自动控制 |
| `POST /position?pet=main&lock=<id>`，`{x,y,mode,duration?}` | 中心坐标归一化为 0–1，mode 为 instant/spring/line；line 的 duration 为 0–120000ms，renderer 再夹到真实显示器工作区 |
| `POST /throw?pet=main&lock=<id>`，`{angle,power}` | 0°向右、90°向上，power 为正且不超过 100；复用原生重力、反弹、摩擦及软限速 |
| `POST /sync` | 经既有鉴权管道触发本地同步，不新增 HTTP 服务 |
| `POST /open-settings` | 经既有鉴权管道定位宠物设置，不新增 HTTP 服务 |

未占用时无需 `lock` 参数，原有手动操作保留。占用期间随机动画、漫游、自动余额展示与工作气泡让路，工作状态仍持续记录；到期自动解冻，旧编号明确返回 `lock-lost`，用户操作可提前接管。回执最多保留 512 条，终态保留 60 秒；120 秒没有后续播放报告的活跃记录转为 `failed/renderer-timeout`。运行时适配与生成代码测试位于 `scripts/dsh-pet-controls-*`，原生检查使用全新私有目录，避免正式采集。

Agent 通知点击会保留 `source + sessionId`，主窗口重建后经挂载读取与按编号确认消费，再进入共享 `/sessions` 页自动展开精确记录。定向查询读取现有采集缓存，在 `localCollectSince` 范围内查历史，不触发补采集，也不依靠标题/子串匹配。未采集、来源身份无法对应或超出采集起点时明确提示未找到，并保留目标等待常规同步重读。

额度来源需要明确选择，直接使用 Quotern 新鲜读数；真实余额和窗口已用百分比分别显示，缺失或陈旧不补零。工作状态只读现有 Codex、Claude、DSH 的新日志，不写 hooks 或统计数据；首次读取只记基线。各来源实际观测状态与缺失原因见设置；Codex 普通完成仅表示“有结果”，不会据此庆祝目标成功。没有明确审批/错误事件时不声称已接入对应档位。过期状态会解除工作循环。

辅助模式在正常应用初始化前分流，使用安装的 Electron、独立 userData 和带启动令牌的随机 Windows 命名管道，无 HTTP 回调端口。关闭开关、退出和更新均回收辅助进程；崩溃显示错误，需手动重试。硬件加速和 DPI 修正仅用于辅助进程。正式资源位于 `resources/dsh-pet/`，构建仅读取固定 vendor 快照，不依赖 `reference/`。

来源：[dsh-pet / PC2005-cloud](https://github.com/PC2005-cloud/dsh-pet)，固定提交 `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f`。代码 MIT；动画、人设等素材禁止商用，介绍、展示及分发需署名并链接上游。安装包保留 LICENSE、MEDIA-LICENSE 和 PATCHES。默认系统字体；不分发授权未核实的软糖体，可自行放入 `fonts/上首软糖体.ttf`。

验证记录见 [Windows 独立宠物验收](../../docs/superpowers/dsh-pet-validation.md)。多屏、异构 DPI 与热插拔仅在有实际设备时验收，不以几何单元测试代替真机验证。

### 原有图集宠物

在「设置 → 宠物」开启，也可用 Windows 托盘菜单的「显示/隐藏桌面宠物」。角色、大小、Bot 颜色和位置保存在 Desktop 的 userData 中；默认不显示。列表首先展示大肥鱼，其后为内置 Clawd、Bot 和导入角色；不再内置 Sprout、Byte、Ember。支持导入标准宠物 ZIP、已安装的 Codex 宠物，以及 codex-pets.net 的宠物地址或 ID；导入角色可移除。下载使用 Electron 默认 session 的系统代理配置，30 秒超时，宠物包上限仍为 12 MB。与内置或已有角色 ID 冲突时按内容摘要分配独立 ID，不覆盖原角色；同一份内容重复导入会复用已有角色，导入成功仍只切换预览。失败提示显示在操作附近，排障见 [宠物导入日志](../../docs/runtime-notes.md#宠物导入与失败日志)。

宠物使用同一份本机用量和订阅额度，后台、主窗口或宠物菜单发起同步时都会显示工作状态。悬浮窗支持点击切换表情与短句、右键菜单开关主窗口、拖动及随方向切换跑动、右侧贴边和 200ms 滑动展开；双击按两次普通点击处理，精灵外区域透传鼠标。Windows 不启用全局鼠标转发，使用 16ms 光标轮询维护命中、悬停及视线；局部坐标只在悬停变化时去重发送给宠物窗口。按下至释放/取消期间保留原生输入和拖拽捕获。窗口不监听全局按键活动，也不读取按键内容。隐藏后停止鼠标位置轮询；系统减少动态效果时暂停精灵逐帧动画。

Windows 实机验收建议：

1. 用隔离开发入口 `pnpm dev:desktop` 启动，打开设置的「宠物」页，确认列表按大肥鱼、Clawd、Bot 排列，开启宠物，依次切换内置角色、大小、Bot 颜色及预览动作。
2. 悬停确认用量气泡和订阅额度；单击观察短句与表情，双击确认不会打开主面板，右键检查菜单；在精灵外空白区域点击底下的窗口，确认鼠标透传。
3. 拖过约 10 像素确认移动，拖动途中反向确认跑动方向切换；拖到屏幕右缘确认贴边，从屏幕边缘缓慢移向角色时保持展开、气泡完整显示，移出后滑动收起。在多显示器间拖动，变更分辨率或断开副屏后确认仍能找回宠物。
4. 隐藏后重新显示、退出并重启 Desktop，确认角色、大小、位置及贴边状态保留。再导入一个合法 ZIP 或 Codex 宠物，检查 V1/V2 图集、移除与重新导入操作。
5. 分别从主窗口、宠物右键菜单触发同步，并等待一次后台自动同步，确认同步期间切换到工作动作、完成后恢复。

`corepack pnpm --filter quotern-desktop exec node scripts/pet-pointer-smoke.mjs` 在全新私有目录中构建输入验收 fixture，运行真实 Electron 窗口、preload 和宠物 renderer，不启动采集、不覆盖正在使用的 `out`。它审计原生穿透/转发调用，通过受控 OS 光标样本与 renderer 输入事件检查悬停倾斜、按下捕获、点击阈值、拖拽反向/释放、取消、贴边展开与隐藏后停止轮询；菜单仅验回调。结果保存在 `apps/desktop/.quotern-dev/pet-pointer-smoke-*/result.json`。该检查不代替真实物理鼠标、多屏或不同 DPI 的人工手感验收。

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

在对应系统执行以下命令只构建并验证，不需要 GitHub 写入 token：

```bash
# macOS：默认 ad-hoc，两架构 DMG/ZIP，手动更新
corepack pnpm release:desktop:mac
# macOS：正式签名、公证与自动更新，需要 Apple 凭据
corepack pnpm release:desktop:mac:signed

# Windows：构建并验证 NSIS/portable、blockmap 和更新清单
corepack pnpm release:desktop:win
```

`electron-builder.yml` 的 `publish` 指向 `yuhengqin/Quotern`，继续生成运行时 `app-update.yml`；客户端读取 Release 附件。无需在源码仓库维护 `releases/*.yml`。

macOS ad-hoc 包通过设置中的「前往下载页」及顶部「手动更新」打开 Releases，不检查或下载自动更新，也不会执行安装 IPC。正式签名模式继续原有自动更新流程。workflow 的 `macos_signing` 默认 `adhoc`，选择 `signed` 才会导入 Apple 凭据；缺少凭据不会自动降级。

统一入口是 `.github/workflows/release-desktop.yml`，等待 Windows、macOS 和无 `.git` 的源码归档构建全部通过，再校验最终文件和相同版本/commit，汇总为 `desktop-release-verified` artifact。默认与 tag push 均不创建 Release。需要上传时，手动选择匹配版本的 tag 并勾选 `publish`，只新建 Draft；不覆盖已有 Release。人工完成实机验收和正文后再公开发布。beta 草稿标记 Pre-release，稳定版本为普通 Release。详细凭据与步骤见 [发布规范](../../RELEASE.md#desktop-统一构建与验收)。已发布安装包、blockmap 和更新清单均需保留，以保证下载与更新。
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
