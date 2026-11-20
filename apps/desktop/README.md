# quotern-desktop

Tauri 2 桌面客户端，与 CLI 共用默认 `~/.quotern` 数据目录。原生宿主为 `src-tauri/src/main.rs`；`src/preload/index.ts` 与 `src/preload/tauri-transport.ts` 提供 `window.tud` 桥接，`src/sidecar/index.ts` 启动 Node runtime。采集和会话分析 worker 由捆绑 Node fork；Desktop 通过 sidecar 内存 local-api 提供与 CLI 相同的 `/functions/tud-*` 契约，不监听 `:8252`。职责和恢复边界见[运行维护注意事项](../../docs/runtime-notes.md)。

同一数据目录的 `tud.pid` 标识唯一采集 owner；Desktop 接管该目录后，CLI 以 observer 提供面板。隔离开发使用现有入口 `corepack pnpm dev:desktop`，数据与服务归属见[worktree 开发规范](../../docs/worktree-development.md)。

桌面额度只在用户同意后通过当前应用会话中的授权访问支持的官方接口，其他情况提供官方用量页；不导入其他应用的登录凭据。授权只属于当前运行会话。

## 启动、构建与验收

在仓库根目录运行 `corepack pnpm dev:desktop` 或 `corepack pnpm build:desktop`。根 `package.json` 提供 `release:desktop:mac`、`release:desktop:mac:signed` 和 `release:desktop:win`；发版步骤与验收见 [RELEASE.md](../../RELEASE.md)。迁移后的更新能力与各平台产物需分别验证，不能沿用旧版验收结论。

构建宿主后，在仓库根目录运行 `node apps/desktop/scripts/tauri-webview-smoke.mjs [built host]`，可验证 WebView 渲染、桥接、健康检查、初始额度授权状态、数据目录 owner 和并发请求期间的帧采样。该检查不代替代表性数据下的桌面响应性实测，也不代表 macOS 或更新功能通过。

## 旧版功能记录

以下保留迁移前的 Electron 功能和验收记录，供对照原有行为；其中 Electron 宿主、IPC、测试入口及平台实现不作为当前 Tauri 行为或已通过验收的证明。涉及变更时应核对当前代码和真实桌面结果。

## 窗口外观

- macOS：`titleBarStyle: 'hidden'`，保留原生红绿灯并垂直居中于 32px 标题条
- Windows：`titleBarStyle: 'hidden'` + 原生 Window Controls Overlay；三键由系统绘制，保留 Snap Layouts、双击最大化与标题栏系统菜单，overlay 颜色随主题同步
- Linux：无边框，渲染层自绘窗控（46×32，Win11 关闭色 `#C42B1C` / `#B22A1E`，最大化后显示双叠方框还原图标，键盘焦点可见）
- 标题条高度由 `shared/window-chrome.ts` 的 `TITLEBAR_HEIGHT` 统一驱动：主进程 overlay 高度与渲染层 CSS 变量同源
- `window.tud`：最小化 / 最大化 / 关闭 + `api.request` / `onDataSynced`

## 系统通知

`src/main/notifications/` 统一管理原生通知、提示音、偏好和会话定位。Agent 活动运行时随 Desktop 启动，不依赖桌宠角色或开关；运行中的宠物仅订阅同一活动流。系统通知使用 Electron `Notification` 并静音，原生 `show` 确认后才独立播放提示音。内置柔和、清脆两段原创 PCM 音效，支持关闭与试听；Windows 使用隐藏 PowerShell `SoundPlayer`，macOS 使用 `afplay`，Linux 使用系统 `paplay`。播放失败保留通知并在设置中显示问题。

Windows 在启动时通过 `app-identity.ts` 设置与安装器一致的 `dev.quotern.desktop` AppUserModelID，并在当前用户下注册 Quotern 显示名和应用图标。隔离 profile 使用独立身份，正常退出删除自己的临时身份；正式身份由卸载器清理。Windows 的 `close` 回调也可能只是横幅超时，通知中心条目仍然存在；管理器在 Windows 保留有界的对象引用，继续支持点击、精确撤销及退出清理，不把横幅消失当作用户已处理（[Electron 35 事件与关闭语义](https://github.com/electron/electron/blob/v35.4.0/docs/api/notification.md#event-close)）。

Windows 通知提供「查看详情」「30 分钟后提醒」，多项时追加「关闭全部提醒」；恢复/重置不提供暂缓。XML 显式静音，由统一声音策略播放提示音。Electron 35 的 Windows click 不返回按钮参数，因此快捷操作经当前实例专用 URI 协议转发至随机命名管道；bootstrap 的激活分支不加载正常主进程、不抢占 runtime 或打开窗口。协议包含随机运行令牌，仅能操作仍有效的通知，查看才导航，暂缓不聚焦窗口。开发入口包含应用路径，portable 使用外层启动器路径，正常退出仅移除仍属于自己的协议；注册失败时保留基础通知并在通知页说明。macOS 使用原生 action，其他平台保留正文点击。

「通知」页仅设置额度提醒和 Agent 厂商服务状态变化的「从不 / 仅后台 / 始终」策略，两类默认始终提醒，提示音默认柔和。订阅页原有阈值、重置、服务和账号规则继续生效。偏好保存在 Electron userData 的 `notifications/preferences.json`；升级时丢弃旧版会话完成、确认、错误策略，保留额度、服务和提示音设置。写入失败保留旧值，损坏时暂停提醒并提供恢复默认入口。

Quotern 不再发送 Agent 会话完成、确认或错误系统通知，也不提供「连接通知」设置。Codex、Claude 的日志和已有可选 Hook 事件仍提供桌宠的工作、等待、结果及错误状态；本轮结束不宣称目标成功。旧 `desktopNotifications` 偏好仅保留为已有 Hook 元数据流的兼容开关，不能启用系统通知。通用「Agent 集成」功能与 Hook 安装/移除入口保留，不自动改写用户的 Agent 配置。

活动监听启动时对已有日志建立 EOF 基线，只读取后续增量，不回放过期历史。Hook 队列最多 512 条，仅保存类型、时间和会话/调用标识，不保存消息或工具输入输出；这些事件只分发给活动订阅者，不进入通知管理器。

「Agent 服务状态变化」来自订阅厂商的官方状态页。在启用订阅通道、服务提醒且通知策略允许时，所关注范围的有效状态级别发生变化才通知，包括故障程度变化和恢复。首次观察、未知或过期状态不会通知；事件新增、正文、处理阶段或时间更新本身不会单独提醒。多个账号按厂商合并。Quotern 自身采集、启动或 watchdog 异常目前主要记录日志，没有独立系统通知链路。

额度通知点击定位对应额度窗口，服务通知点击定位「服务状态与事件」详情。共享会话精确定位与桌宠导航的兼容通道保留。

额度按厂商、已验证账号（否则 reader）和窗口替换，服务按厂商替换。服务正文展示级别、已订阅的异常组件及最新事件摘要。状态对账在无新提示时也撤销已失效的阈值、旧周期、恢复前故障和已关闭规则的通知；stale/unknown 不视为恢复。未公开账号引用的 reader 使用进程内递增版本识别切换，不透传私有身份。异常最长保留 24 小时，额度有已知重置时间时提前过期；恢复/重置保留 10 分钟。暂缓 30 分钟后仅重发同范围最新且仍有效的提醒；恢复、禁用、删除和退出取消重发，不跨重启补发。

普通提醒进入固定 1 秒合并窗口，同 scope 更新不延长窗口；额度耗尽和严重服务中断立即发送。多项摘要显示数量及最多三项标题，查看进入额度面板，其余信息继续从账号/服务详情访问；单项保持精准定位。每项的有效期、策略与暂缓独立管理，部分事项失效后保留其余事项，不重复播放已显示提醒的声音。混合摘要的暂缓只重新安排警告，不再次安排恢复/重置。

通知设置标题旁的「关闭全部提醒」与原生动作共用管理器，一次撤销本进程管理的通知中心条目、待合并事项和暂缓事项；不改提醒偏好，新事件仍正常通知。该入口不枚举或清除应用重启前遗留的系统历史。原生横幅按系统默认时长自动收起，横幅收起不视为已处理。macOS 使用原生附加动作，Linux 及原生注册失败时可从设置清理。

「通知」页提供正式可用的测试通知；旧订阅页测试入口仍仅限 Vite 开发模式。`corepack pnpm test:notifications-ui [全新输出目录]` 使用隔离 profile、数据和受控事件，检查 Codex/Claude 日志和已有 Hook 活动仍可订阅且不发系统通知、额度/服务通知与点击、真实 preload/设置、键盘操作、保存失败及旧偏好兼容，生成宽/窄屏截图及结果 JSON。检查捕获系统 Toast 的 `show()`，不代表验证系统权限或实际送达；会调用一次生产提示音试听路径。

追加 `--actions-only` 只运行活动保留与通知动作链路，不创建窗口、不操作桌面输入、不播放声音，也不显示系统 Toast；Windows 仍通过真实系统 URI 激活和 bootstrap 转发验证查看定位、暂缓撤销、全部清理及不打开窗口，并检查普通提醒合并、耗尽即时发送。完整 UI 验收再检查设置清理的键盘操作和失败重试。它不能代替原生横幅、图标或通知中心的可视验收。

### Windows 原生与 CLI 实测

另有手动选择运行的原生验收入口，默认测试不启动它。它保留 Electron 的真实 `show` / `close` / 协议激活，记录 toast XML、实际动作和撤销事件，使用独立数据、profile、Agent 配置与临时 Windows 应用身份，正常退出时撤销通知并删除自己的身份和协议。私有采集只读取本次 CLI 的日志。主用户的 Agent 配置、凭据、Hook 信任记录及系统通知设置保持原样。

在 worktree 根运行，下例两个命令分别在两个终端中执行，输出目录必须全新：

```powershell
corepack pnpm exec node apps/desktop/scripts/run-notifications-native-live.mjs .quotern-dev/native-review-01
corepack pnpm exec node apps/desktop/scripts/notifications-agent-live.mjs .quotern-dev/native-review-01 codex-confirm
```

CLI 验收支持 `codex-complete`、`codex-confirm`、`codex-error`、`claude-complete`、`claude-confirm`、`claude-error`；同一 Agent 串行执行。使用已安装的真实 CLI，但模型响应及 HTTP 400 API 故障由 localhost 受控端点提供，不调用云模型。确认场景只请求打印固定标记，等待输出目录中的 `release-codex-confirm` / `release-claude-confirm` 文件后才允许这条测试命令；不授予会话或持久权限。Codex 的一次性 Hook 信任放行仅限验收实例中已经核对的自有脚本。CLI 路径可由 `QUOTERN_TEST_CODEX` / `QUOTERN_TEST_CLAUDE` 指定。

CLI 场景现在用于观测活动流：应记录完成、等待及错误状态，同时不产生 Agent 系统通知。手动检查额度/服务原生通知时，向验收目录的 `command.json` 写入 `send` 指令，类别只允许 `quota` 或 `service`。使用 `ready.json` 中的临时 `appId`，通过 Windows PowerShell 5.1 读取原生历史：

```powershell
Set-Content -LiteralPath '.quotern-dev/native-review-01/command.json' -Value '{"id":"send-1","action":"send","category":"service"}'
powershell.exe -NoProfile -NonInteractive -File apps/desktop/scripts/notifications-windows-history.ps1 -AppId '<ready.json 中的 appId>'
Set-Content -LiteralPath '.quotern-dev/native-review-01/command.json' -Value '{"id":"burst-1","action":"send-burst","count":3}'
# 等 reply.json 确认，再检查历史只增加一个摘要；点击原生「关闭全部提醒」后再次检查历史。
Set-Content -LiteralPath '.quotern-dev/native-review-01/command.json' -Value '{"id":"quit-1","action":"quit"}'
```

原生验收不代表真实云端故障、安装包升级或 macOS/Linux 实机验收。确认场景仍需按前述 `release-codex-confirm` / `release-claude-confirm` 文件释放受控命令；Quotern 不再为该请求显示通知。

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

Agent 活动流由独立运行时提供，只用于桌宠状态展示，不发送完成、确认或错误系统通知。

额度来源需要明确选择，直接使用 Quotern 新鲜读数；真实余额和窗口已用百分比分别显示，缺失或陈旧不补零。工作状态订阅独立 Agent 活动流，本身不安装 Hook 或修改统计数据。各来源实际观测状态与缺失原因见设置；Codex 普通完成仅表示“有结果”，不会据此庆祝目标成功。过期状态会解除工作循环。

辅助模式在正常应用初始化前分流，使用安装的 Electron、独立 userData 和带启动令牌的随机 Windows 命名管道，无 HTTP 回调端口。关闭开关、退出和更新均回收辅助进程；崩溃显示错误，需手动重试。硬件加速和 DPI 修正仅用于辅助进程。正式资源位于 `resources/dsh-pet/`，构建仅读取固定 vendor 快照，不依赖 `reference/`。

来源：[dsh-pet / PC2005-cloud](https://github.com/PC2005-cloud/dsh-pet)，固定提交 `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f`。代码 MIT；动画、人设等素材禁止商用，介绍、展示及分发需署名并链接上游。安装包保留 LICENSE、MEDIA-LICENSE 和 PATCHES。默认系统字体；不分发授权未核实的软糖体，可自行放入 `fonts/上首软糖体.ttf`。

验证记录见 [Windows 独立宠物验收](../../docs/superpowers/dsh-pet-validation.md)。多屏、异构 DPI 与热插拔仅在有实际设备时验收，不以几何单元测试代替真机验证。

### 原有图集宠物

在「设置 → 宠物」开启，也可用 Windows 托盘菜单的「桌面宠物」勾选开关。角色、大小、Bot 颜色和位置保存在 Desktop 的 userData 中；默认不显示。列表首先展示大肥鱼，其后为内置 Clawd、Bot 和导入角色；不再内置 Sprout、Byte、Ember。支持导入标准宠物 ZIP、已安装的 Codex 宠物，以及 codex-pets.net 的宠物地址或 ID；导入角色可移除。下载使用 Electron 默认 session 的系统代理配置，30 秒超时，宠物包上限仍为 12 MB。与内置或已有角色 ID 冲突时按内容摘要分配独立 ID，不覆盖原角色；同一份内容重复导入会复用已有角色，导入成功仍只切换预览。失败提示显示在操作附近，排障见 [宠物导入日志](../../docs/runtime-notes.md#宠物导入与失败日志)。

宠物使用同一份本机用量和订阅额度，后台、主窗口或宠物菜单发起同步时都会显示工作状态。悬浮窗支持点击切换表情与短句、右键菜单开关主窗口、拖动及随方向切换跑动、右侧贴边和 200ms 滑动展开；双击按两次普通点击处理，精灵外区域透传鼠标。Windows 不启用全局鼠标转发，使用 16ms 光标轮询维护命中、悬停及视线；局部坐标只在悬停变化时去重发送给宠物窗口。按下至释放/取消期间保留原生输入和拖拽捕获。窗口不监听全局按键活动，也不读取按键内容。隐藏后停止鼠标位置轮询；系统减少动态效果时暂停精灵逐帧动画。

Windows 上，图集宠物显示时立即以 `screen-saver` 层级重申置顶，可见期间每 5 秒再次执行；隐藏、窗口关闭和控制器退出时清理定时器。恢复不依赖 `isAlwaysOnTop()`：Windows 的置顶样式位为真时，实际窗口顺序仍可能异常。重申通过原生不激活窗口的调用完成，保留位置与输入焦点，用于恢复普通桌面窗口之间的层级。

Windows 实机验收建议：

1. 用隔离开发入口 `pnpm dev:desktop` 启动，打开设置的「宠物」页，确认列表按大肥鱼、Clawd、Bot 排列，开启宠物，依次切换内置角色、大小、Bot 颜色及预览动作。
2. 悬停确认用量气泡和订阅额度；单击观察短句与表情，双击确认不会打开主面板，右键检查菜单；在精灵外空白区域点击底下的窗口，确认鼠标透传。
3. 拖过约 10 像素确认移动，拖动途中反向确认跑动方向切换；拖到屏幕右缘确认贴边，从屏幕边缘缓慢移向角色时保持展开、气泡完整显示，移出后滑动收起。在多显示器间拖动，变更分辨率或断开副屏后确认仍能找回宠物。
4. 隐藏后重新显示、退出并重启 Desktop，确认角色、大小、位置及贴边状态保留。再导入一个合法 ZIP 或 Codex 宠物，检查 V1/V2 图集、移除与重新导入操作。
5. 分别从主窗口、宠物右键菜单触发同步，并等待一次后台自动同步，确认同步期间切换到工作动作、完成后恢复。

`corepack pnpm --filter quotern-desktop exec node scripts/pet-pointer-smoke.mjs` 在全新私有目录中构建输入验收 fixture，运行真实 Electron 窗口、preload 和宠物 renderer，不启动采集、不覆盖正在使用的 `out`。它审计原生穿透/转发调用，通过受控 OS 光标样本与 renderer 输入事件检查悬停倾斜、按下捕获、点击阈值、拖拽反向/释放、取消、贴边展开与隐藏后停止轮询；菜单仅验回调。随后通过 Windows PowerShell 运行 `pet-topmost-native.ps1`，仅在核对 PID 归属的测试窗口上真实降级层级，并在 Electron API 边界模拟置顶查询仍返回真，检查恢复后的原生顺序、位置、宠物未激活以及隐藏/重显行为。这不是对原始 Windows 样式位异常触发过程的重现。结果保存在 `apps/desktop/.quotern-dev/pet-pointer-smoke-*/result.json`。该检查不代替真实物理鼠标、多屏或不同 DPI 的人工手感验收。

## 待统一规划

- 顶层菜单与窗口拖拽区域
- Windows 代码签名；macOS 打包已启用 hardened runtime 和 notarize，发版前需配置有效身份与凭据

## 发版与更新

当前发版入口及验收见上方和 [RELEASE.md](../../RELEASE.md)。旧版自动更新记录不代表当前宿主已实现或通过验证。

## 桌面订阅额度

当前桌面额度访问遵循上方的用户同意和当前会话授权边界；未授权时提供官方用量页。旧版按其他应用登录状态读取额度的做法不适用于当前桌面宿主。
