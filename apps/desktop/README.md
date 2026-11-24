# quotern-desktop

Tauri 2 桌面客户端，与 CLI 共用默认 `~/.quotern` 数据目录。原生宿主为 `src-tauri/src/main.rs`；`src/preload/index.ts` 与 `src/preload/tauri-transport.ts` 提供 `window.tud` 桥接，`src/sidecar/index.ts` 启动 Node runtime。采集和会话分析 worker 由捆绑 Node fork；Desktop 通过 sidecar 内存 local-api 提供与 CLI 相同的 `/functions/tud-*` 契约，不监听 `:8252`。职责和恢复边界见[运行维护注意事项](../../docs/runtime-notes.md)。

同一数据目录的 `tud.pid` 标识唯一采集 owner；Desktop 接管该目录后，CLI 以 observer 提供面板。隔离开发使用现有入口 `corepack pnpm dev:desktop`，数据与服务归属见[worktree 开发规范](../../docs/worktree-development.md)。

桌面额度需要用户明确授权。官方 CLI 的授权可以跨重启继续使用，用户可在卡片中断开。手动输入的 API 密钥和本地服务令牌随当前应用会话结束而清除。其他来源提供官方用量入口。

## 启动、构建与验收

在仓库根目录运行 `corepack pnpm dev:desktop` 或 `corepack pnpm build:desktop`。根 `package.json` 提供 `release:desktop:mac`、`release:desktop:mac:signed` 和 `release:desktop:win`；发版步骤与验收见 [RELEASE.md](../../RELEASE.md)。迁移后的更新能力与各平台产物需分别验证，不能沿用旧版验收结论。

构建宿主后，在仓库根目录运行 `node apps/desktop/scripts/tauri-webview-smoke.mjs [built host]`，可验证 WebView 渲染、桥接、健康检查、初始额度授权状态、数据目录 owner 和并发请求期间的帧采样。该检查不代替代表性数据下的桌面响应性实测，也不代表 macOS 或更新功能通过。

## 窗口与托盘

Tauri 管理主窗口、托盘面板和参考价格窗口。主窗口关闭后隐藏到托盘；从托盘退出时，桌面端等待 Node 停止采集、释放 `tud.pid`。托盘面板按点击所在显示器的工作区定位，支持全局额度快捷键。主题、语言、自启动和静默启动继续使用桌面偏好，Windows 便携版的自启动项使用外层启动器路径。

## 系统通知

额度和服务状态提醒共用 `src/main/notifications` 的管理器，`src/sidecar/notifications.ts` 负责偏好、合并、暂缓、定时撤回和导航。Agent 活动仍驱动桌宠的工作和等待状态。Windows 使用 WinRT Toast 和当前实例的协议激活，macOS 应用包使用 UserNotifications。通知设置保存在桌面 profile 的 `notifications/preferences.json`。

从仓库根运行 `corepack pnpm test:notifications-ui` 可检查通知设置、窗口定位、键盘和写入失败反馈。`--actions-only` 检查查看、暂缓、清除动作。Windows 实际投递验收使用已构建的 Tauri 宿主和隔离目录，例如 `node apps/desktop/scripts/run-notifications-native-live.mjs .quotern-dev/native-review-01`。该命令在系统通知中心检查测试条目，再撤回条目。

## Windows 桌面宠物

### 独立 dsh-pet

Windows 设置 → 宠物 → **大肥鱼**。默认关闭，仅运行单实例；大肥鱼与图集宠物互斥，启用任意一方会自动持久关闭另一方。旧偏好若同时启用两方，启动时优先保留大肥鱼。保留上游 106 段透明视频、点击得分/粒子、动作菜单、漫游、拖拽甩抛、反弹和多屏几何。右键菜单提供动作、额度查看、复位、重载及打开 Quotern。

单击依次轮换配置的回应动作并显示本机统计短句，视频播放结束后恢复原展示。悬停显示今日用量、明确标为参考的 USD 费用，以及最多三个有效额度窗口；其余窗口可通过点击轮换查看。画面整体轻微倾斜并遵守 reduced-motion。鼠标静止满 60 秒且没有工作状态或控制占用时，宠物播放哈欠后睡眠，鼠标移动唤醒。慢速拖动至屏幕右侧外边缘可收起；悬停后以 200ms 过渡展开，离开 300ms 后收回。收起时仅露出身体边缘，不使用 mini 素材；多屏接缝不收边。位置和收边状态保存在 helper 私有目录的 `companion-position.json`，返回初始位置可清除。

保留 Q 弹、飞行抓取得分、拖拽甩抛和原动作菜单；右键菜单新增「立即同步」与「宠物设置」。

设置提供与 Clawd 角色可见高度相近的小、中、大三档，视频画布宽度分别为 204、264、364 像素；旧数字尺寸在运行时归到最近档位。初始角落及水平、垂直偏移不再提供表单选项，仍可拖拽宠物调整位置。

配置位于桌面 profile 的 `dsh-pet/`。隔离开发使用启动输出中的专用 profile。设置的“打开独立目录”可定位；配置支持动作、物理、字体、额度来源和工作状态。历史模型设置及记忆文件保留在磁盘，不再使用且不会删除。种类包为 `pet/<名称>-config.json`，对应 `pet/<名称>-animation/`、`pet/<名称>-memes/`。main 覆盖素材放 `main-animation/webm/` 和 `memes/`。修改后保存配置或右键重载。高级编辑只改主配置，种类包通过目录内文件编辑。

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

大肥鱼运行在独立的 Tauri WebView 窗口中，Node 辅助进程管理配置、控制请求和视频资源。窗口使用私有协议读取媒体，支持 Range 请求。关闭、重建窗口和退出会释放当前实例，异常关闭后可以从设置重试。构建读取固定的 vendor 快照。

来源：[dsh-pet / PC2005-cloud](https://github.com/PC2005-cloud/dsh-pet)，固定提交 `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f`。代码 MIT；动画、人设等素材禁止商用，介绍、展示及分发需署名并链接上游。安装包保留 LICENSE、MEDIA-LICENSE 和 PATCHES。默认系统字体；不分发授权未核实的软糖体，可自行放入 `fonts/上首软糖体.ttf`。

验证记录见 [Windows 独立宠物验收](../../docs/superpowers/dsh-pet-validation.md)。多屏、异构 DPI 与热插拔仅在有实际设备时验收，不以几何单元测试代替真机验证。

### 原有图集宠物

在「设置 → 宠物」开启，也可用 Windows 托盘菜单的「桌面宠物」勾选开关。角色、大小、Bot 颜色和位置保存在 Desktop 的 userData 中；默认不显示。列表首先展示大肥鱼，其后为内置 Clawd、Bot 和导入角色；不再内置 Sprout、Byte、Ember。支持导入标准宠物 ZIP、已安装的 Codex 宠物，以及 codex-pets.net 的宠物地址或 ID；导入角色可移除。Node 辅助进程负责下载并校验宠物包，大小上限为 12 MB。与内置或已有角色 ID 冲突时按内容摘要分配独立 ID，不覆盖原角色；同一份内容重复导入会复用已有角色，导入成功仍只切换预览。失败提示显示在操作附近，排障见 [宠物导入日志](../../docs/runtime-notes.md#宠物导入与失败日志)。

宠物使用同一份本机用量和订阅额度，后台、主窗口或宠物菜单发起同步时都会显示工作状态。悬浮窗支持点击切换表情与短句、右键菜单开关主窗口、拖动及随方向切换跑动、右侧贴边和 200ms 滑动展开；双击按两次普通点击处理，精灵外区域透传鼠标。Windows 不启用全局鼠标转发，使用 16ms 光标轮询维护命中、悬停及视线；局部坐标只在悬停变化时去重发送给宠物窗口。按下至释放/取消期间保留原生输入和拖拽捕获。窗口不监听全局按键活动，也不读取按键内容。隐藏后停止鼠标位置轮询；系统减少动态效果时暂停精灵逐帧动画。

Windows 原生宿主在显示桌宠时将窗口置顶，并在窗口可见期间每 5 秒重新设置置顶。窗口关闭后停止轮询。

Windows 实机验收建议：

1. 用隔离开发入口 `pnpm dev:desktop` 启动，打开设置的「宠物」页，确认列表按大肥鱼、Clawd、Bot 排列，开启宠物，依次切换内置角色、大小、Bot 颜色及预览动作。
2. 悬停确认用量气泡和订阅额度；单击观察短句与表情，双击确认不会打开主面板，右键检查菜单；在精灵外空白区域点击底下的窗口，确认鼠标透传。
3. 拖过约 10 像素确认移动，拖动途中反向确认跑动方向切换；拖到屏幕右缘确认贴边，从屏幕边缘缓慢移向角色时保持展开、气泡完整显示，移出后滑动收起。在多显示器间拖动，变更分辨率或断开副屏后确认仍能找回宠物。
4. 隐藏后重新显示、退出并重启 Desktop，确认角色、大小、位置及贴边状态保留。再导入一个合法 ZIP 或 Codex 宠物，检查 V1/V2 图集、移除与重新导入操作。
5. 分别从主窗口、宠物右键菜单触发同步，并等待一次后台自动同步，确认同步期间切换到工作动作、完成后恢复。

在 Windows 上运行 `corepack pnpm --filter quotern-desktop exec node scripts/pet-pointer-smoke.mjs`，可在两种桌宠的真实窗口中检查置顶、精灵命中和空白区域鼠标穿透。`scripts/pet-context-menu-smoke.mjs` 验证原生右键菜单。`scripts/dsh-pet-controls-smoke.mjs` 与 `scripts/dsh-pet-helper-interactions.mjs` 接受宿主可执行文件和全新输出目录，检查视频回执、控制抢占、收边恢复与窗口重建。

## 发版与更新

Windows 构建 x64 和 ARM64 安装包与便携版。macOS 提供 ad-hoc 与正式签名构建。签名更新的密钥、架构及验收命令见 [RELEASE.md](../../RELEASE.md)。

## 桌面订阅额度

14 个来源各保留一张卡片。可接入的来源由用户在卡片上主动授权。其他卡片提供官方用量页或官方查询命令说明。各类授权的有效期与设置见 [订阅额度管理](../../docs/quota-management.md)。
