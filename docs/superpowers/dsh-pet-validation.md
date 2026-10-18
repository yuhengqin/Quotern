# Windows 独立 dsh-pet 验收记录

日期：2026-10-19。工作区：`C:\Users\Admin\.codex\worktrees\independent-dsh-pet\Quotern`；分支：`codex/independent-dsh-pet`。保留 worktree，不合并 main、不推送、不发布。实现已完成；下表明确区分自动化、实际 Electron 渲染与尚未完成的现场交互验收。

## 实现与自动化

| 项目 | 结果与边界 |
| --- | --- |
| 素材和离线构建 | 固定上游 `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f`。106 WebM，54,351,332 字节，全部核对原始 SHA256；正式构建不访问 reference。未包含 GIF、未核实 TTF、用户模型或记忆文件。 |
| 上游行为 | 复用动画选择、双 video、物理、漫游、积分粒子、菜单、碰撞、DPI/显示器和输入区域代码。上游纯逻辑测试接入 Desktop 测试。三处依赖未移植浏览器 overlay/原 DSH host 的源码守卫显式跳过，不计作验证通过；Desktop runtime 守卫继续执行。 |
| 独立设置 | Windows 应用设置单独入口；主开关、实例增删/尺寸/角落/功能开关、物理/字体、额度来源、独立 provider/key/model、人设/周期、手动聊天/动作/碎碎念、记忆清除、JSONC 与目录入口。zh-CN/en/ja/ko 文案键和插值一致。 |
| pet pack | 同时兼容上游平铺 `<名称>-animation/<动作>.webm` 和格式子目录；main 仍为 `main-animation/webm/`。JSON/JSONC 包的显示设置写回真实原文件。路径穿越/链接、独占池和配置继承有测试。 |
| 模型/记忆 | 本地受控 OpenAI 兼容 HTTP mock 覆盖成功、失败、截断、一次回落、去重、总截止时间、聊天排队、取消、记忆隔离与损坏备份；聊天取消同宠物待完成碎碎念，取消不更新 say。未使用真实付费模型 key。 |
| 额度 | 使用现有 QuotaState，缺失/陈旧不补零。真实 CNY 余额独立；比例窗口保留实际标签与重置时间。测试覆盖缺数据与最紧迫有效窗口。 |
| 活动 | Codex/Claude/DSH 只读增量日志，首次 EOF 基线不回放；重复、部分行、过期、中止与 goal 续跑有处理。DSH todo 文字按会话聚合，新 turn/过期清理。完整六状态与优先级测试；不把普通 task_complete 当目标成功。各来源仅报告实际观测档位。 |
| 通知 | 明确事件、主窗口失焦、总开关与事件去重有集成测试。Windows 实际通知横幅未目视验收。 |
| 生命周期 | 默认关闭、重复开启单 helper、崩溃错误/手动重试、重载等待退出、暂停/恢复和取消有测试；退出/更新路径已接入。真正安装更新未触发。 |

全仓库 `corepack pnpm build` 和 `corepack pnpm test` 先由独立 verifier 执行通过。审查修正后主代理对最终代码再次执行完整 `corepack pnpm test`（包含全仓库构建）：**1693 tests，1658 pass、35 skip、0 fail**。其中 Desktop **717 tests，697 pass、20 skip、0 fail**（含构建准备测试 3 项）；Desktop 类型检查、renderer 构建和文案校验也通过。精确断言覆盖取消碎碎念不写 say、带 todo 的会话过期清空和通知条件。

日志在本地 `.superpowers/sdd/2026-10-19-dsh-pet-desktop/`：`workspace-{typecheck,build,tests}.log`、`workspace-tests-final.log`、`final-{typecheck,localization,desktop-build}.log`、`task-7-tests.log`。该目录是本次验收产物，不进入安装包或 Git。

## Windows 与打包产物

`corepack pnpm dev:desktop` 成功启动本 worktree 的隔离 Desktop，实际 Vite 端口 5196，数据和 Electron profile 均在本 worktree `.quotern-dev/`。computer-use 两次截图分别返回 `FrameArrived timed out`、`window capture timed out`，因此后续采用应用自带 Electron 自检与真实 preload IPC 测试，不把它等同于 OS 合成和真实鼠标手感验收。

| 实际执行 | 结果 |
| --- | --- |
| 开发 Electron helper 自检 | 两只透明 BrowserWindow；视频/光标加载，无 renderer 错误；菜单挂载、慢放保持位置、身体内外判定、拖拽保持输入、主进程 ignore-mouse 切换断言通过；自检后正常退出。 |
| 打包 helper 自检 | 使用真正 `win-unpacked/Quotern.exe --quotern-dsh-pet-helper` 和包内资源，独立 profile。相同断言通过，证明早期分流、私有管道、资源位置和打包 DPI probe 路径可执行；106 个动作文件均可解析读取。 |
| 打包正常主应用 | 全新隔离数据/profile，实际 preload IPC：默认关闭、开启、两实例配置重载、mock 聊天、两条历史、停用、正常 app:quit 退出码 0。Windows safeStorage 对测试 key 加密保存，返回状态不回显 key。旧 Clawd 与新宠物同时开启；停用新宠物后旧宠物仍为开启，最后单独关闭旧宠物。 |
| renderer 截图 | 实际打包设置面板正确出现独立卡片。helper PNG 含 alpha；抽检开发自检图为 560×451、206,671 个完全透明像素，角色与气泡实际解码渲染。此图不是 Windows 桌面合成截图。 |
| 最终包审计 | 包内 106 WebM 哈希与字节全部匹配；LICENSE/MEDIA-LICENSE/PATCHES/host/helper/shared-core 存在；没有私有模型、记忆、reference、GIF 或 TTF。 |

最终实际运行证据：本地同目录下 `native-packaged-delivery/{result.json,stdout.log,stderr.log,helper.png}`、`packaged-app-delivery/{result.json,stdout.log,stderr.log,main.png}`。自检与包装脚本位于 `apps/desktop/scripts/{native-dsh-pet-smoke.ts,packaged-dsh-pet-smoke.mjs,audit-dsh-pet-package.mjs}`；测试仅使用专属目录和本地 mock，正常退出后核对本 worktree Electron/Quotern 可执行文件无残留进程。

原 `corepack pnpm build:desktop:win` 在 winCodeSign 解压 Darwin 符号链接时遭遇 Windows 权限错误。使用现有构建产物运行以下明确的本地未签名覆盖后，NSIS 和 portable 产物均成功生成：

```powershell
corepack pnpm --filter quotern-desktop exec electron-builder --win '--config.win.signAndEditExecutable=false' --publish never
```

输出在 `apps/desktop/release/0.1.13/`；日志为 `windows-package.log`（原命令失败原因）和 `windows-unsigned-package-final.log`（本地未签名成功）。未安装、签名或发布；实际启动的是其 `win-unpacked/Quotern.exe`。

## 尚未覆盖与工作区残留

- 真实鼠标的连续点击得分/粒子、快速甩抛手感、下层应用实际点击穿透、跨屏飞行、异构 DPI、屏幕热插拔与减少动效设置的现场检查仍未完成。检测到两块显示器并执行了原几何逻辑，但这不能替代逐屏手动验收。
- 全部动作文件和菜单可达性已核对，未逐段目视观看 106 段视频；真实外部模型、所有 Agent 的全部事件、实际系统通知及更新安装未验证。旧宠物实际选择/启停/并存已验，导入与贴边依赖既有测试覆盖。
- 本次开发会话 `084d29f5-684c-4695-a85b-4b2464735ffc` 经终端停止后，其 supervisor、已记录子进程和 Job guardian 均不在运行，但 guardian 未生成“Job 全部后代退出”凭据。按 `docs/worktree-development.md` 保留 `.quotern-dev` 会话锁，没有伪造凭据、删除锁或接管其他服务；再次 `dev:desktop` 会被该锁阻止，需按规范人工核验处理。main 工作区不受影响。最终包验收使用另外的专属临时数据/profile。

完整独立代码审查发现的四项缺陷已修复，并经另一位 reviewer 限定复核，无新增阻塞项。原始 vendor 快照未修改；所有适配与自检前提修正在生成层记录。
