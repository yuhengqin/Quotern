# Independent dsh-pet Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Repository role rules apply: the primary agent owns design and semantic implementation; subagents only perform bounded read-only work, explicit mechanical edits, or verification.

**Goal:** 在 Windows Desktop 提供独立且保留完整行为的 dsh-pet，不并入现有宠物。

**Architecture:** 保留上游 shared 和每宠一窗的 Electron helper，以 Quotern 托管的辅助模式运行。新的宿主模块经带令牌的私有命名管道提供原 runtime 契约，负责配置、模型、额度及有证据的 Agent 状态；设置通过独立 IPC 操作。

**Tech Stack:** Electron 35.4.0、TypeScript、React 19、Node 内置 net/fs/crypto/fetch、pnpm 11.1.2；用显式开发依赖 esbuild 构建 vendor 的浏览器 IIFE/宿主 CJS。

**Spec:** [2026-10-19-dsh-pet-desktop-design.md](../specs/2026-10-19-dsh-pet-desktop-design.md)

## Global Constraints

- 工作区 `C:\Users\Admin\.codex\worktrees\independent-dsh-pet\Quotern`，分支 `codex/independent-dsh-pet`；不修改/构建/切换 main，不推送、不发布。
- 固定上游 `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f`；106 WebM，54,351,332 字节；正式构建不读取 `reference/`。
- Windows Desktop 首发；新宠物默认关闭；现有 pet controller、目录、IPC 和角色保持独立。
- helper 的硬件加速/DPI 设置只在辅助进程应用；复用安装的 Electron，不下载第二份运行时。
- Windows 使用命名管道，不使用 piped stdin 或本地 HTTP 回调；区分 `thinking/working/result/waiting/success/error` 与采集同步。
- 聊天使用独立用户 API 配置；不读取订阅或 DSH 凭证。字体默认 system，不分发未核实 TTF；保留原作者链接、代码许可和素材非商用说明。
- 开发只用 `corepack pnpm dev:desktop` 隔离入口；临时 mock 与测试目录由当前任务创建和清理。

## Review Focus

1. 打包后的辅助模式必须在单实例锁/runtime 接管前分流；用实际 Windows 包验证，不能只测 dev。
2. 管道断开、helper 崩溃、停用、退出和更新过程中必须取消模型调用并回收子进程；不能残留窗口或无限重启。
3. 编码路径、目录符号链接、pet pack 和大消息不能越过登记目录或撑爆桥接内存；实际资源请求做边界测试。
4. 历史事件、重复事件、沉默、过期和异步回调不能制造刚完成/成功状态或写回已停用实例。
5. 多实例共享模型/额度刷新时应避免重复请求、串记忆、错误回落和重复通知；用本地 mock 验证。

## 文件职责

- `apps/desktop/vendor/dsh-pet/`：上游 shared、独立 host 纯模块、runtime、所需媒体、默认配置、来源清单与许可。适配改动列在 `PATCHES.md`。
- `apps/desktop/scripts/prepare-dsh-pet.mjs` 与同名 `.test.mjs`：资源清单校验、构建 `out/dsh-pet/shared-core.js`/`host.cjs`、复制运行文件。
- `apps/desktop/src/shared/dsh-pet.ts`：设置、脱敏状态、受限操作及桥接契约。
- `apps/desktop/src/main/dsh-pet/{config-store,asset-store,rpc,model-service,activity,service,controller}.ts` 与对应 `.test.ts`：各负责一种宿主职责。
- `apps/desktop/src/main/bootstrap.ts`：最早区分正常应用与 helper 模式；不在 helper 模式导入正常入口。
- `apps/desktop/src/renderer/components/DshPetSettingsCard.tsx`：独立设置与操作；现有 `SettingsPanel.tsx` 仅增加 Windows 入口。
- `apps/desktop/src/preload/index.ts`、`src/renderer/i18n/desktop-renderer-messages.ts`：独立 IPC 和设置控件文案。
- Desktop `package.json`、`electron.vite.config.ts`、`electron-builder.yml`、`README.md`、`THIRD_PARTY_NOTICES.md` 与 Desktop changeset：构建、打包及交付说明。

共享契约在 Task 2 的 `src/shared/dsh-pet.ts` 定义：`MergedConfig = Record<string, Record<string, unknown>>`；`RpcRequest = {id:number,method:string,url:string,body?:string}`；`RpcResponse = {status:number,contentType?:string,body?:string,file?:string}`。`ModelSettings` 为 `{providers:Array<{id,name,baseUrl,models:string[],apiKeyConfigured:boolean}>,defaultModel:{provider,model}|null}`；key 仅存在写入操作 `ProviderPatch.apiKey`，不进入该读模型。`ModelResult` 为 `{ok:boolean,text?:string,image?:string,reason?:string,provider?:string,model?:string,fallback:boolean}`。`SourceCapabilities` 为 `{source:string,states:WorkStatusState[],reason:string|null,lastEventAt:string|null}`，`WorkStatusState` 六个值与 spec 完全一致；`BalanceState` 保持上游 `balance/types.ts` 的 windows/money/失败判别联合。

### Task 1: 固定上游源码与可复现构建

**Interfaces:** `prepareDshPet({vendorRoot,outputRoot}): Promise<void>`；产出 `out/dsh-pet/` 的 runtime、assets、shared-core.js 和 host.cjs。host.cjs 导出上游 config/state/work-status/memes/model-selection 的独立函数，浏览器 IIFE 导出 `PetShared`。

- [x] 在 `scripts/prepare-dsh-pet.test.mjs` 写失败用例：106 个动作全部存在、总字节等于 54,351,332、输出排除 GIF/TTF、移走 reference 后仍可构建；缺少/哈希不符资源必须失败。
- [x] 执行 `node --test apps/desktop/scripts/prepare-dsh-pet.test.mjs`，确认缺少构建脚本/资源时失败。
- [x] 将确定清单内的上游文件复制到 vendor，附 SHA256、上游提交、许可及 PATCHES；默认字体改 system，默认展示设 desktop。新增构建脚本及显式 esbuild 开发依赖，接入 dev/build，不改变原包主入口。
- [x] 在新 worktree 安装固定依赖并运行上述测试，确认产物能加载 `PetShared` 与 host 模块。
- [x] 检查只含本任务文件后提交：`build(desktop): vendor dsh-pet runtime and assets`。

### Task 2: 配置、资源与受限私有 RPC

**Interfaces:** `DshPetConfigStore(root, vendorRoot)` 提供 `read(): MergedConfig`、`readText(): string`、`saveText(text): Promise<void>`、`reset(): Promise<void>`；`DshPetAssetStore.resolve(route): Promise<AssetResponse|null>`；`DshPetRpcServer.start(handler): Promise<{endpoint,token}>`、`close(): Promise<void>`；handler 输入 `{id,method,url,body?}`，输出 `{status,contentType?,body?,file?}`。

- [x] 写 `config-store.test.ts`、`asset-store.test.ts`、`rpc.test.ts`：JSONC/种类覆盖、坏配置不覆盖最后有效内容、原子保存、编码 traversal/symlink 拒绝、错误 token、消息上限、超时/断开清理。使用临时目录与本地 socket，不读用户私有配置。
- [x] 运行 Desktop 测试编译及指定测试，确认新模块缺失导致失败。
- [x] 实现上游配置规则的 facade、只读资源解析和有界 JSON 行 RPC。Windows 随机命名管道，测试平台使用临时 Unix socket；请求必须通过 token 和方法/路由白名单。
- [x] 同命令确认上述测试通过，目录外文件内容始终不能被返回。
- [x] 请求预算保持一致：聊天/碎碎念生成（含回落）总计不超过 50 秒，UI 60 秒，管道 65 秒；取消、队列等待和重试均计入请求截止时间。测试慢首选+回落不能越过总期限，不沿用上游 45 秒 bridge 与 60 秒模型的不一致组合。
- [x] 提交：`feat(desktop): add isolated dsh-pet host storage and transport`。

### Task 3: 模型服务、记忆和额度适配

**Interfaces:** `DshPetModelService` 提供 `generate({petId,kind,messages,preferred?,signal}): Promise<ModelResult>`、`setProviders(patch): Promise<void>`、`publicState(): ModelSettings`、`dispose(): void`；`ModelResult` 带实际 provider/model 和 fallback 标记。`toDshPetBalance(quota,selection): BalanceState` 保持上游 balance 契约。

- [x] 写 `model-service.test.ts`/`service.test.ts`：受控 HTTP mock 的成功、截断、失败、一次回落、相同模型去重、取消不回落、关闭后不写记忆、两宠物记忆隔离、并发聊天/碎碎念、系统加密不可用时不写明文、脱敏状态无 key；额度陈旧/缺失/最紧窗口不伪造余额。
- [x] 运行指定测试并确认缺模块失败。
- [x] 实现 OpenAI 兼容请求、独立加密 provider 存储、按实例请求队列/记忆、上游人设/表情包及周期调度；额度直接消费现有 `QuotaState`，刷新去重。
- [x] 用相同 mock 测试确认通过，不使用真实付费 key。provider 未配置时明确失败，其它宠物行为可运行。
- [x] 提交：`feat(desktop): connect dsh-pet models memory and quota`。

### Task 4: 真实活动事件与宿主行为契约

**Interfaces:** `DshPetActivityMonitor({roots,onEvent,now})` 提供 `start(): Promise<void>`、`dispose(): void`、`capabilities(): SourceCapabilities[]`；事件为 `{id,source,sessionId,turnId?,timestamp,state,evidence}`。`DshPetService.handle(request): Promise<RpcResponse>` 提供原桌面 runtime 实际使用的 config/state/chat/whisper/balance/anim/reload 路由及素材请求。

- [x] 写 `activity.test.ts` 和 `service.test.ts`：六档聚合/优先级、首次扫描不重播历史、增量跨行、重复/过期事件、不同会话、不明确结束不当成功、无审批证据不造 waiting、停止后回调无效；runtime 契约逐路由测试。
- [x] 运行测试确认失败，再实现独立只读 Codex/Claude/DSH 增量适配器和完整上游状态/动作/说话契约；不修改现有计量、hook 配置或采集调度。
- [x] 来源目录发现复用 Core `discoverSessionInputs(source)` 的路径/多目录规则（现有导出不适用则仅增加只读导出），活动读取由独立 monitor 维护增量游标；不得改写统计 parser 或将活动事件写入计量快照。
- [x] runtime 契约包含 `GET /config`（成品聚合）、`GET /state`（sections/pets/configVersion）、`POST /balance`、`POST /whisper?pet`、`POST /chat?pet`（写 say 后仅返回动作结果）、`GET /chat?pet`（历史）、`POST /anim?pet`、`POST /broadcast?pet`、`POST /pet-display`、`POST /reload` 及 thumb/font/pic 资源。状态计数使用 `max(Date.now(),last+1)`；首次只记基线；空闲写 `{state:null,task:null}` 而非整个 data=null；资源使用 assetRoot，不以实例 ID 替代。
- [x] 宿主按上游配置保留自动余额与每宠碎碎念调度；手动碎碎念不受自动开关限制。重载必须等待旧 helper 退出再按最新实例列表启动，不能只刷新当前窗口。
- [x] 将宠物自身模型请求的真实状态接入；通知仅由明确事件触发，失焦/总开关及去重规则可测。各 Agent 返回实际能力清单和未接入原因。
- [x] 运行指定测试，确认同步完成、沉默和旧任务不触发 success/error。
- [x] 提交：`feat(desktop): adapt dsh-pet activity and host actions`。

### Task 5: 辅助模式、窗口桥与生命周期

**Interfaces:** `initializeDshPet({root,vendorRoot,quota,showMainWindow,onChanged}): Promise<DshPetController>`；controller 提供 `getState()`、`dispatch(action)`、`pause(): Promise<void>`、`dispose(): Promise<void>`。独立 IPC 前缀 `dsh-pet:`，helper 模式参数 `--quotern-dsh-pet-helper`。

- [x] 写 `controller.test.ts`/bootstrap 检查：默认关闭不 spawn；显式开启只创建一个 helper；参数/环境不含模型 key；独立 userData；退出、更新、断管、崩溃清理且不无限重启；helper 分支不加载正常主入口。
- [x] 确认失败后实现 bootstrap 与 controller；正常主入口仍为现有 index，构建同时产出 bootstrap/index，quota preview 也有正确入口。helper 复用当前 Electron，可追溯 PID 与启动令牌；打包和开发路径都显式解析。
- [x] 在 vendor helper 替换 HTTP callback 为命名管道客户端；沿用原窗口、DPI、命中区、碰撞及播放器。配置重载更新实例窗口；“打开 DSH”改为宿主动作唤起 Quotern。
- [x] 用测试确认生命周期，再检查 main 的 will-quit/beforeInstall/安装失败恢复路径都正确清理或恢复本子系统。
- [x] 提交：`feat(desktop): host independent dsh-pet companion windows`。

### Task 6: 独立设置及完整操作入口

**Interfaces:** `window.tud.dshPet` 提供 `getState()`、`dispatch(action)`、`onState(callback)`；状态只包含配置、运行/错误、模型配置标识、来源能力和可用操作，不含 key/聊天正文。

- [x] 在 preload 及 shared 契约建立受限操作：启停/重试、配置读取保存/复位、实例管理、provider 保存删除、模型选择、记忆清除、目录打开、手动动作/聊天；验证未知 action 和非法 sender 拒绝。
- [x] 实现 `DshPetSettingsCard.tsx`：主开关和运行反馈、实例增删/大小位置/功能开关、物理与字体、额度来源、模型/API 配置、模型调用费用说明、来源能力状态、高级 JSONC 校验和手动控制。复用 HeroUI 当前文档模式，保留完整 JSONC 能力。
- [x] 加入 Windows SettingsPanel 和设置控件的三语文案；保留上游可配置的人设和动画文本，不篡改已有宠物入口。
- [x] 执行 Desktop typecheck、localization catalogs 检查和独立 renderer 构建；在实际隔离 Desktop 核对操作、错误反馈与密钥不回显。
- [x] 提交：`feat(desktop): expose independent dsh-pet settings`。

### Task 7: Windows 打包与回归验收

**Files:** Desktop 打包配置、README、THIRD_PARTY_NOTICES、`.changeset/independent-dsh-pet.md`，本计划的验证记录。

- [x] 打包包含 `out/dsh-pet/**`，检查无 reference/GIF/未核实 TTF，无模型凭证和测试私有数据。补充原作者链接、MIT 与素材非商用说明。
- [x] 执行 `corepack pnpm --filter quotern-desktop typecheck`、Desktop tests、`corepack pnpm build`、`corepack pnpm test`；只针对实际失败修复并重跑相关检查。
- [ ] 通过 `corepack pnpm dev:desktop` 启动本 worktree，逐项对照 spec 行为表；截图/日志记录透明视频、点击、甩抛、菜单聊天、多实例碰撞及退出回收。旧宠物选择/导入、额度气泡和贴边回归。
- [ ] 执行 `corepack pnpm build:desktop:win`；运行未发布 Windows 包，在隔离 userData 下验证 helper 分流、全部素材读取、菜单/聊天和退出。设备缺失的多屏/DPI/热插拔验收明确标为未覆盖。
- [x] 由新的只读 reviewer 审查最终分支，再定点修复和验证。检查暂存范围并提交；交付分支/工作区/验证证据及剩余限制，保留 worktree 等用户集成，不改 main、不推送。

## 执行方法与交接

用户已确认计划。复杂实现由主代理在当前聊天原生执行；子代理仅进行有界源码定位、机械复制、验证和独立审查。全部变更留在 `codex/independent-dsh-pet`，保留 worktree，不合并 main、不推送。

Task 7 两项现场验收保留未勾选：Windows Electron/打包自检、主程序 IPC、mock 聊天、系统加密、退出和资源审计已通过；实际鼠标手感、跨屏/DPI/热插拔及系统合成截图未验收，原标准打包命令遇到签名工具的符号链接权限限制，本地未签名覆盖构建通过。详情及开发会话锁的保留原因见 [验收记录](../dsh-pet-validation.md)。
