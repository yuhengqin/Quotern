# Windows 独立 dsh-pet 验收记录

> 本文为早期接入记录；当前设置与功能以 `apps/desktop/README.md` 为准。2026-10-22 已移除模型 API、聊天和自动碎碎念。

## 2026-10-22 设置精简与互斥验收

- Desktop 构建、类型检查和本地化目录检查通过；Desktop 两阶段自动化共 756 项通过、20 项跳过、0 失败，包含快速开关排序回归和生成产物无聊天入口的检查。
- `scripts/dsh-pet-settings-interactions.mjs` 使用全新隔离目录执行真实 Windows Electron 设置页检查，45/45 通过。覆盖三档大小、保存草稿、物理/字体/额度、动作、重试、高级配置及错误恢复。
- `scripts/dsh-pet-helper-interactions.ts` 使用独立宿主执行真实辅助窗口检查，22/22 通过。三档角色命中区高度约为 71、91、118 CSS 像素；保留鼠标穿透、拖拽、三级动作菜单、额度气泡及重载，根菜单无聊天/生成碎碎念入口。动作池中同名视频仍保留。
- `scripts/dsh-pet-size-exclusive-smoke.mjs` 使用本次构建的 Desktop 和自建双开偏好执行 10 项检查，全部通过。覆盖启动恢复、两方向切换、并发启用、快速开启后关闭、开关持久化和被移除端点返回 404。
- 上述检查只写入各自全新临时目录；未发布或安装新版本，未重新验收多屏、异构 DPI、热插拔及正式打包客户端。

以下为早期接入及后续专项验收记录。

日期：2026-10-19。实现工作区：`C:\Users\Admin\.codex\worktrees\independent-dsh-pet\Quotern`；分支：`codex/independent-dsh-pet`。按用户后续授权，人工恢复该 worktree 的开发会话锁，并将功能合并到 `D:\AgentPro\Quotern` 的 `main`。保留原 worktree 和分支，未推送、未发布。下表明确区分自动化、实际 Electron 渲染与尚未完成的现场交互验收。

## 实现与自动化

| 项目 | 结果与边界 |
| --- | --- |
| 素材和离线构建 | 固定上游 `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f`。106 WebM，54,351,332 字节，全部核对原始 SHA256；正式构建不访问 reference。未包含 GIF、未核实 TTF。 |
| 上游行为 | 复用动画选择、双 video、物理、漫游、积分粒子、菜单、碰撞、DPI/显示器和输入区域代码。上游纯逻辑测试接入 Desktop 测试。三处依赖未移植浏览器 overlay/原 DSH host 的源码守卫显式跳过，不计作验证通过；Desktop runtime 守卫继续执行。 |
| 独立设置 | Windows 应用设置单独入口；主开关、动作、物理/字体、额度来源、工作状态、JSONC 与目录入口。zh-CN/en/ja/ko 文案键和插值一致。 |
| pet pack | 同时兼容上游平铺 `<名称>-animation/<动作>.webm` 和格式子目录；main 仍为 `main-animation/webm/`。JSON/JSONC 包的显示设置写回真实原文件。路径穿越/链接、独占池和配置继承有测试。 |
| 额度 | 使用现有 QuotaState，缺失/陈旧不补零。真实 CNY 余额独立；比例窗口保留实际标签与重置时间。测试覆盖缺数据与最紧迫有效窗口。 |
| 活动 | Codex/Claude/DSH 只读增量日志，首次 EOF 基线不回放；重复、部分行、过期、中止与 goal 续跑有处理。DSH todo 文字按会话聚合，新 turn/过期清理。完整六状态与优先级测试；不把普通 task_complete 当目标成功。各来源仅报告实际观测档位。 |
| 通知 | 明确事件、主窗口失焦、总开关与事件去重有集成测试。Windows 实际通知横幅未目视验收。 |
| 生命周期 | 默认关闭、重复开启单 helper、崩溃错误/手动重试、重载等待退出、暂停/恢复和取消有测试；退出/更新路径已接入。真正安装更新未触发。 |

全仓库 `corepack pnpm build` 和 `corepack pnpm test` 先由独立 verifier 执行通过。审查修正后主代理对最终代码再次执行完整 `corepack pnpm test`（包含全仓库构建）：**1693 tests，1658 pass、35 skip、0 fail**。其中 Desktop **717 tests，697 pass、20 skip、0 fail**（含构建准备测试 3 项）；Desktop 类型检查、renderer 构建和文案校验也通过。精确断言覆盖带 todo 的会话过期清空和通知条件。

日志在本地 `.superpowers/sdd/2026-10-19-dsh-pet-desktop/`：`workspace-{typecheck,build,tests}.log`、`workspace-tests-final.log`、`final-{typecheck,localization,desktop-build}.log`、`task-7-tests.log`。该目录是本次验收产物，不进入安装包或 Git。

合并后在 main 执行 `corepack pnpm --filter quotern-desktop typecheck` 和完整 `corepack pnpm test`（包含全仓库构建），均退出 0。14 个 runner 合计 **1739 tests，1704 pass、35 skip、0 fail**；Desktop 两个 runner 合计 **726 tests，706 pass、20 skip、0 fail**。日志保存在上述实现 worktree 的 `merge-main-{typecheck,tests}.log`。没有重新进行原生交互或 Windows 打包验收，下文的现场验收边界仍适用。

main 原依赖目录沿用旧布局，首次无 TTY 安装被 pnpm 拒绝。按当前 worktree 规范备份本工作区六处依赖入口后，重新执行 `corepack pnpm install --frozen-lockfile --prefer-offline` 成功，锁文件未改动；实际 `virtualStoreDir` 为 `D:\.pnpm-store\v11\links`，Desktop 的 esbuild 解析到共享存储，core/i18n 仍解析到 main 的对应 workspace 包。安装记录为 `merge-main-install{,-retry}.log`。自动审批以 `blocked by policy` 拒绝删除迁移备份，因此保留 `D:\AgentPro\Quotern\.quotern-dev\dependency-backup-merge-1f1a27c67b4943eeb5fe4066f850b5f3`（含六处原依赖入口及 manifest），未改动共享存储和其他 worktree 依赖；该备份不影响构建、测试或合并。

## Windows 与打包产物

`corepack pnpm dev:desktop` 成功启动本 worktree 的隔离 Desktop，实际 Vite 端口 5196，数据和 Electron profile 均在本 worktree `.quotern-dev/`。computer-use 两次截图分别返回 `FrameArrived timed out`、`window capture timed out`，因此后续采用应用自带 Electron 自检与真实 preload IPC 测试，不把它等同于 OS 合成和真实鼠标手感验收。

| 实际执行 | 结果 |
| --- | --- |
| 开发 Electron helper 自检 | 两只透明 BrowserWindow；视频/光标加载，无 renderer 错误；菜单挂载、慢放保持位置、身体内外判定、拖拽保持输入、主进程 ignore-mouse 切换断言通过；自检后正常退出。 |
| 打包 helper 自检 | 使用真正 `win-unpacked/Quotern.exe --quotern-dsh-pet-helper` 和包内资源，独立 profile。相同断言通过，证明早期分流、私有管道、资源位置和打包 DPI probe 路径可执行；106 个动作文件均可解析读取。 |
| 打包正常主应用 | 全新隔离数据/profile，实际 preload IPC：默认关闭、开启、两实例配置重载、停用、正常 app:quit 退出码 0。旧 Clawd 与新宠物同时开启；停用新宠物后旧宠物仍为开启，最后单独关闭旧宠物。 |
| renderer 截图 | 实际打包设置面板正确出现独立卡片。helper PNG 含 alpha；抽检开发自检图为 560×451、206,671 个完全透明像素，角色与气泡实际解码渲染。此图不是 Windows 桌面合成截图。 |
| 最终包审计 | 包内 106 WebM 哈希与字节全部匹配；LICENSE/MEDIA-LICENSE/PATCHES/host/helper/shared-core 存在；没有 reference、GIF 或 TTF。 |

最终实际运行证据：本地同目录下 `native-packaged-delivery/{result.json,stdout.log,stderr.log,helper.png}`、`packaged-app-delivery/{result.json,stdout.log,stderr.log,main.png}`。自检与包装脚本位于 `apps/desktop/scripts/{native-dsh-pet-smoke.ts,packaged-dsh-pet-smoke.mjs,audit-dsh-pet-package.mjs}`；测试仅使用专属目录和本地 mock，正常退出后核对本 worktree Electron/Quotern 可执行文件无残留进程。

原 `corepack pnpm build:desktop:win` 在 winCodeSign 解压 Darwin 符号链接时遭遇 Windows 权限错误。使用现有构建产物运行以下明确的本地未签名覆盖后，NSIS 和 portable 产物均成功生成：

```powershell
corepack pnpm --filter quotern-desktop exec electron-builder --win '--config.win.signAndEditExecutable=false' --publish never
```

输出在 `apps/desktop/release/0.1.13/`；日志为 `windows-package.log`（原命令失败原因）和 `windows-unsigned-package-final.log`（本地未签名成功）。未安装、签名或发布；实际启动的是其 `win-unpacked/Quotern.exe`。

## 尚未覆盖与工作区收尾

- 真实鼠标的连续点击得分/粒子、快速甩抛手感、下层应用实际点击穿透、跨屏飞行、异构 DPI、屏幕热插拔与减少动效设置的现场检查仍未完成。检测到两块显示器并执行了原几何逻辑，但这不能替代逐屏手动验收。
- 全部动作文件和菜单可达性已核对，未逐段目视观看 106 段视频；所有 Agent 的全部事件、实际系统通知及更新安装未验证。旧宠物实际选择/启停/并存已验，导入与贴边依赖既有测试覆盖。
- 原开发会话 `084d29f5-684c-4695-a85b-4b2464735ffc` 缺失 guardian 完成凭据，初次交付时保留会话锁。后续按用户明确授权人工核验：原 supervisor、已记录子进程、guardian 及匹配 worktree/Job 名称的进程均不存在；两次只读 `OpenJobObjectW` 返回 `ERROR_FILE_NOT_FOUND (2)`。严格核对会话与两个 owner 的身份字段、原始文件哈希及普通目录内容后，在对应 resource gate 内仅移除 `runtime.lock` 和 `desktop-ui.lock`。原始会话、owner、配置、哈希及独立核验记录保存在实现 worktree 的 `.superpowers/sdd/2026-10-19-dsh-pet-desktop/manual-lock-recovery/`；没有补造 guardian 凭据或清空数据。随后使用实际 `createDevSession(..., 'desktop')` 成功获取并正常释放两锁，记录为 stopped，无 lock/guard 残留；此检查没有启动开发服务。Windows Job 生命周期依据为 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects#managing-job-objects)。

完整独立代码审查发现的四项缺陷已修复，并经另一位 reviewer 限定复核，无新增阻塞项。原始 vendor 快照未修改；所有适配与自检前提修正在生成层记录。

## 启用开关回归修复（2026-10-19）

实际设置卡片的开关遗漏了 HeroUI 3.2.4 必需的 `Switch.Content`，因此只有 Control/Thumb 外观，没有 switch input，也不会触发启用 IPC。此前包验收直接调用 IPC，并仅确认设置卡片存在，未覆盖这条 UI 入口。现已采用安装库及本地 controlled demo 的交互结构，保持原有受控状态、busy 和错误反馈。

首次没有可选 `main-config.jsonc` 时，宿主原本也会对默认回退发出“pets 缺失或为空”告警；实际聚合配置已包含默认宠物，不是启用失败的原因。读取时现将这种正常首启映射到内置默认层，不创建或重写用户文件；显式空 `pets` 的异常告警与回退仍保留。

两项回归均先复现失败：旧 Windows 包缺少可交互 switch input；新首启用例捕获误告警。修复后 Desktop 类型检查、依赖及 Desktop 构建通过，Desktop 测试 **727 tests，707 pass、20 skip、0 fail**。重新构建本地未签名 win-unpacked 后，增强的 `packaged-dsh-pet-smoke.mjs` 经真实渲染 DOM、Electron CDP 鼠标/Space 输入、preload IPC 验证鼠标启用、键盘停用、鼠标再次启用及 helper 运行，同时保留两实例与旧宠物并存和正常退出检查。人工鼠标/DPI 验收边界不变。

本地证据为实现 worktree 的 `.superpowers/sdd/2026-10-19-dsh-pet-desktop/enable-{config-red,config-green,ui-red,typecheck-after-build,build,tests,package,ui-green}.log` 与 `enable-ui-green/{result.json,main.png,stdout.log,stderr.log}`。将工作区从旧实现分支更新到 main 后，第一次类型检查读取了尚未重建的 Core dist；重建本工作区依赖后再次类型检查通过，未更改相关类型或断言来规避错误。

## 按钮与交互实测复查（2026-10-19）

在原 worktree 的 `codex/audit-dsh-pet-interactions` 分支继续修复。使用重新构建的本地未签名 `win-unpacked/Quotern.exe`，每轮创建独立 profile/data 和随机本地调试端口，经 Electron CDP 发送实际鼠标/键盘输入；没有操作用户正在使用的 main 开发实例。

旧包实测发现并修复以下三类问题：

| 问题 | 修复及回归证据 |
| --- | --- |
| 编辑后立即点按钮，首击被失焦保存期间的 disabled 吞掉 | 失焦保存进入后台串行队列，前台操作排在其后；首次点击即新增实例，之前的编辑保留。配置合并读取队列执行时的最新值。 |
| JSONC 保存或重置后，已编辑输入框仍显示旧值 | 保存成功后同步字段；保存中的后续草稿按编辑代次保留，避免旧回执覆盖输入。测试为本轮独立 app 的单笔 IPC 注入可释放延迟，实际执行 B → C → B 编辑，验证焦点、节点、两次旧回执和最终失焦保存。 |
| 重置失败也清空 JSONC 草稿 | 仅成功后清空；在专属 profile 中制造写入失败，验证错误可见、草稿原样保留，之后恢复测试文件。 |

设置脚本 **75/75** 项通过：六个折叠组鼠标/Enter/Space、实例增删与最后实例保护、连续编辑、四类实例开关、物理/字体、主开关、辅助进程退出后的重试、额度/动作/错误反馈、被删除实例的目标回退、JSONC 读写/失败/重置及打开目录。崩溃测试仅终止 CIM 核实为本轮私有 app 直接子进程的 helper，重试确实启动新 PID。

helper 脚本 **19/19** 项通过：两只真实宠物窗口、左击、右键/Esc/外部点击关闭、真正三级动作菜单及所选视频、缺额度提示、打开 Quotern 回调、拖拽归位、重载更换 helper PID。菜单隐藏自身后，下一用例通过宿主恢复独立测试 fixture，不将其计为用户菜单操作。

Desktop 类型检查及构建、本地未签名打包均退出 0。完整 `corepack pnpm test`（包含全仓库构建）退出 0：14 个 runner 合计 **1742 tests，1707 pass、35 skip、0 fail**，Desktop 合计 **729 tests，709 pass、20 skip、0 fail**。原有打包主应用 smoke 再次通过，覆盖旧宠物并存、鼠标/键盘主开关、两实例重载及正常退出；原生 helper 自检再次通过，保留输入区域/穿透标记/慢放位置等原检查。

实际操作脚本为 `apps/desktop/scripts/dsh-pet-settings-interactions.mjs`、`dsh-pet-helper-interactions.ts`，共用 `desktop-cdp.mjs`。从仓库根复跑（输出目录必须全新）：

```powershell
corepack pnpm build:desktop
corepack pnpm --filter quotern-desktop exec electron-builder --win --dir '--config.win.signAndEditExecutable=false' --publish never
corepack pnpm exec node apps/desktop/scripts/dsh-pet-settings-interactions.mjs apps/desktop/release/0.1.13/win-unpacked/Quotern.exe .superpowers/sdd/settings-new-run
corepack pnpm --filter quotern-desktop exec esbuild scripts/dsh-pet-helper-interactions.ts --bundle --platform=node --format=cjs --outfile=../../.superpowers/sdd/helper-interactions.cjs
corepack pnpm exec node .superpowers/sdd/helper-interactions.cjs apps/desktop/release/0.1.13/win-unpacked/Quotern.exe apps/desktop/release/0.1.13/win-unpacked/resources/dsh-pet .superpowers/sdd/helper-new-run
```

原始失败和修复后日志/截图/结果均在本 worktree `.superpowers/sdd/2026-10-19-dsh-pet-desktop/`：`interactions-settings-initial-3*`、`interactions-helper-initial*`、`interactions-service-red.log`、`interactions-settings-fixed-2*`、`interactions-helper-fixed-2*`、`interactions-{build,package,typecheck-final,workspace-tests,packaged-final,native-final}.log`。首次扩大脚本时的键盘 Enter 事件和隐藏菜单定位也已修正，未将这些驱动错误算成产品缺陷。

本轮未添加真实额度账号、未安装/发布。真实 Windows 输入法、鼠标手感、下层应用点击穿透、多屏/DPI/热插拔及系统通知仍保留前文的人工验收边界。原始 vendor 快照不变，输入修复通过有守卫的生成补丁应用。

## Windows 全桌面鼠标卡顿调查（2026-10-19）

用户补充：开启独立宠物后，鼠标在整个桌面移动时均有卡顿。继续使用独立 worktree，分支 `codex/fix-dsh-pet-pointer-jank`，基于 main `6fba8d0`；没有关闭用户正在使用的 main 开发实例。

原 helper 唯一的 `setWindowIgnore` 出口始终使用 `{ forward: true }`。Electron 35.4.0 在 Windows 首次启用 forwarding 时注册进程共享的 `WH_MOUSE_LL` 全局低级鼠标钩子；每条全局 `WM_MOUSEMOVE` 都经过此回调，即使鼠标不在宠物窗口内。只有最后一个转发窗口退出集合才卸载 hook。源码见 [native_window_views_win.cc](https://github.com/electron/electron/blob/v35.4.0/shell/browser/native_window_views_win.cc#L512-L590)。微软说明，低级 hook 在鼠标事件分发到输入队列前、回到安装线程执行，因此辅助进程 UI 线程的停顿可能拖延其他应用的输入，见 [LowLevelMouseProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)。该回调内部向 renderer 使用的是异步 `PostMessage`，不能解释成“同步等待 renderer 回复”。

这是与用户描述吻合且已确认存在的全局输入阻塞风险。宿主还有每秒配置读取和日志扫描成本，但指定调用链未发现鼠标移动直接触发这些操作或主窗口全量 React 更新；没有据此顺带重写采集或活动监听。由于本轮两次 Windows Graphics Capture 分别返回 `FrameArrived timed out` 和 `window capture timed out`，未完成真实物理鼠标的关闭／开启钩子 A/B 测量，**不能声称已确认本次卡顿的唯一原因或已测得改善幅度**。

修复在生成层关闭所有 Windows helper 窗口的 forwarding，并将已有全局光标轮询由 60ms 改为 16ms。命中、穿透、拖拽租约和菜单控件矩形继续使用原判定；hover 通过去重局部坐标样本维护，只在身体内位置变化、离体或 busy 结束时发送。远处桌面移动不持续发 renderer IPC，采样不参与真实拖拽或浮层输入，非 Windows 的 forwarding 与 60ms 行为保留。16ms 轮询恢复交互存在至多一个采样周期加调度时间的响应延迟，真实快速点击手感仍需人工验收。原始 vendor 快照不变。

生成产物的 Windows hook 禁用断言先失败（`true !== false`），修复后通过；审查发现 busy 结束可能漏掉一次离体同步，又以单测先复现 `null` 与退出坐标不符，再修正并增加松手后 tooltip 隐藏断言。adapter 用例覆盖静止去重、窗口移动、同坐标命中区变化、离体一次、远处大量更新和 busy→idle。

扩展 `dsh-pet-helper-interactions.ts`：在专属 helper 中仅替换 `screen.getCursorScreenPoint()` 输入，运行真正的原生轮询 timer，并记录 `BrowserWindow.setIgnoreMouseEvents` 调用及 renderer 接收结果。验证无 forwarded DOM mousemove 仍可恢复 hover、所有观测的 Windows ignore 调用均关闭 forwarding、离体恢复穿透、远处移动不刷 IPC、菜单输入与窗外拖拽捕获。此测试证明实际 timer、桥接和输入状态契约，不等同于向 Windows 注入真实鼠标输入；随后继续执行原 19 项 helper 交互检查。

最终 25/25 项 helper 检查通过，Desktop 类型检查、完整 Desktop 构建、本地未签名 win-unpacked 打包均退出 0。完整 `corepack pnpm test`（含全仓构建）退出 0：14 个 runner 合计 **1744 tests，1709 pass、35 skip、0 fail**；Desktop 合计 **731 tests，711 pass、20 skip、0 fail**。原生 helper smoke 和打包主应用 smoke 再次通过，包括两只宠物、106 个素材解析、输入状态、开关、旧宠物并存和正常退出。未安装、未发布；真实 Windows 全桌面卡顿改善须在重启开发实例加载新生成资源后由用户确认。

本地调查及回归证据在实现 worktree 的 `.superpowers/sdd/2026-10-19-dsh-pet-desktop/`：`pointer-build-{red,green}.log`、`pointer-busy-red.log`、`pointer-{build-final,package-final,helper-final,workspace-tests,typecheck,native,packaged}.log` 与对应结果目录。`pointer-profile-*` 是隔离调查 fixture，未改动用户 profile；Windows 截图失败后停止 OS 自动化，没有将其当作物理鼠标性能验证成功。

## 控制回执与通知会话定位（2026-10-21）

基于 `86742ba`，定向接入上游 `cf3ed3c4dd6829b252f352d4c61a18db6fdb26d4` 的播放回执、可续期占用锁、位置与抛掷控制；原始 vendor 快照保持 `6c5f043`，通过 Quotern host 与生成的 `runtime/controls.js` 适配。通知保留 `source + sessionId`，经主进程 pending/ACK 在窗口重建后定位共享会话页，读取已采集历史并展开精确记录；未找到时不替换成相似会话。接口和边界见 [Desktop README](../../apps/desktop/README.md#独立-dsh-pet)。

独立审查发现并修复三条时序问题，均先复现再增加回归：终态回执跨清理时间的等待异常、锁期间工作状态归零导致解锁后动画停顿，以及用户接管后迟到的状态快照重新冻结宠物。生成运行时测试还覆盖首拉前已有指令、真实媒体事件成功/失败/替换、屏幕边界和拖拽优先级。

最终验证环境为 Windows、Node `v24.14.0`、Corepack pnpm `11.1.2`。以下命令均退出 0：

| 检查 | 结果 |
| --- | --- |
| `corepack pnpm test`（含全仓构建） | 1805 tests：1770 pass、35 skipped、0 fail |
| `corepack pnpm --filter quotern-desktop typecheck` | 通过 |
| `corepack pnpm --filter quotern-dashboard exec tsc --noEmit` | 通过 |
| `git diff --check` | 通过 |

35 项跳过包括符号链接 2、POSIX 开发实例/运行时 9、Windows 打开文件覆盖限制 1、Desktop 平台限定 17、vendor dsh-pet 源码守卫 3、Linux systemd 3。三个 vendor 守卫涉及浏览器余额气泡、配置唯一填充点、宠物固定双端一致性，这些静态守卫本轮没有执行。完整输出在本工作区 `.quotern-dev/control-final-verification.log`。

新增两份按需运行的原生验收脚本，均使用全新私有 profile/fixture，无正式日志根目录或额度账号：

- `apps/desktop/scripts/dsh-pet-controls-smoke.ts`：真实 Electron helper、透明视频、鉴权管道与 CDP 输入，**10/10 通过**。覆盖锁暂停两路 video、ended/failed/替换回执、instant/line/spring 位置、抛掷物理、指针接管和到期解冻。证据：`.quotern-dev/controls-acceptance-20261021-g/result.json`、`helper.png`。
- `apps/desktop/scripts/dsh-pet-navigation-smoke.ts`：真实 Notification 对象的 click 回调、Desktop preload、React 路由和 Core 缓存，**4/4 通过**。覆盖 renderer 挂载前点击定位旧会话、重复点击重开详情、窗口销毁重建后连续点击保留最新目标、缺失目标不回退相似记录。证据：`.quotern-dev/navigation-acceptance-20261021-b/result.json`、`missing-session.png`。

原生检查脚本及 helper 已正常退出，按其专属启动路径查询未发现遗留 Electron 进程。通知检查拦截 `show()` 并在真实 Notification 对象上触发 `click`，**不包含 Windows 系统 toast 实际投递和人工点击**；CDP 指针输入也不等同于物理鼠标手感或跨应用穿透验收。未重新验证多屏/DPI/热插拔、签名安装包或发布，未改动正式用户配置和采集数据。
