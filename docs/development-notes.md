# 开发协作注意事项

协作修改前先确认模块范围和运行入口，提交时让文档、代码及验证结果对应同一份实现。架构见 [architecture-notes.md](./architecture-notes.md)，统计规则见 [data-notes.md](./data-notes.md)，运行恢复见 [runtime-notes.md](./runtime-notes.md)。

## 环境与启动

并行 worktree、分支及开发服务归属遵守 [worktree 开发规范](./worktree-development.md)。开发用 `pnpm dev:*` 的私有运行目录与端口；不要停止其他会话的服务来腾端口。实际地址及归属记录由启动输出和 `pnpm dev:status` 提供。

发布产物声明 Node.js >= 20；仓库开发和测试使用 Node.js 22.13+，以满足 `node:sqlite` 和 TypeScript 测试运行需求。包管理器版本由根 [package.json](../package.json) 的 `packageManager` 指定，当前为 pnpm 11.1.2。依赖版本以 lockfile 为准。

```bash
pnpm install --frozen-lockfile
pnpm dev:cli
# 实际 API / Vite 地址见启动输出；默认端口占用时选择空闲端口
```

桌面开发使用 `pnpm dev:desktop`。CLI 托管构建产物时使用 `pnpm start:cli`，该命令先构建 Core / Dashboard / CLI，再启动服务；它不提供浏览器页面 HMR。Electron 下载镜像配置见 [CONTRIBUTING.md](../CONTRIBUTING.md#安装依赖的注意事项)。

## 修改范围

1. 修改 `packages/dashboard/src` 的共享 UI 或数据层时，检查 `apps/desktop/src/renderer` 的同名副本；需要同步时在同一变更中处理。
   UI 组件选择、复用边界、筛选菜单及界面验收遵守 [UI 组件与交互规范](./ui-guidelines.md)。
2. Core 类型或计算规则变更需要核对 CLI 和 Desktop 消费方。浏览器共享模块必须保持 browser-safe，不能引入 Node 文件系统依赖。
3. 新增数据源时同时检查 parser、来源规范化、sync 调度、状态展示、图标映射与相应测试，不直接复用其他来源的累计量假设。
4. 新测试使用临时目录、虚构凭据、受控环境变量和模拟网络；避免扫描开发者真实主目录、读取实际账号或影响已运行服务。

开发时使用 [Contributing Guide](../CONTRIBUTING.md) 的分支、提交及 PR 规范。浏览器面板假数据需要通过 `VITE_ENABLE_MOCK_DATA=true` 显式开启；不要把本地环境文件或测试账户状态打入分发产物。

## 构建与验证

与 [CI](../.github/workflows/ci.yml) 对齐的检查为：

```bash
pnpm build
pnpm --filter quotern-desktop typecheck
pnpm -r --if-present test
```

根命令 `pnpm test` 等价于先 `pnpm build` 再跑各包测试。Desktop 的 `electron-vite build` 不负责完整类型检查，不能代替单独的 `typecheck`。CI 使用 Node 22，并在 Ubuntu、macOS、Windows 上分别运行。

只验证相关包时，先构建依赖；例如：

```bash
pnpm --filter quotern-core build
pnpm --filter quotern-core test
pnpm --filter quotern-desktop test
```

测试报告要区分自动化断言、当前机器检查和平台实机结果。某平台跳过的测试不能写成已通过；桌面单元测试也不能代替签名安装包、更新安装或原生窗口验收。

## 源码组合与配置

保留可构建的依赖闭包：CLI 构建要用 Dashboard dist，Dashboard 和 Desktop 都依赖 Core；同时需要根 workspace、TypeScript 配置、lockfile、脚本及实际引用的资源文件。精简源码后从干净目录重新安装并构建所保留入口，避免本机旧 dist 掩盖缺文件。

分发配置需要明确归属：

| 配置 | 核对入口 |
| --- | --- |
| 包名、npm 发布范围、repository / homepage | 根和各包 `package.json` |
| 应用标识、产品名称、签名与 GitHub 发布目标 | `apps/desktop/electron-builder.yml` |
| 更新与发布目标 | `apps/desktop/electron-builder.yml`，构建生成 `app-update.yml` |
| 网页下载地址 | `packages/dashboard/src/lib/downloads.ts` |
| 价格覆盖表默认地址 | `packages/core/src/pricing/baked-defaults.ts` |
| 静态资源路径 | `packages/dashboard/vite.config.ts`、环境变量示例 |

只记录所需环境变量和配置方式，实际凭据、签名证书、账号文件和运行日志由各自环境提供。源码分发保留 [LICENSE](../LICENSE) 与依赖、素材的来源说明。发布是独立操作，具体步骤见 [RELEASE.md](../RELEASE.md)。

## 文档与变更记录

维护注意事项描述当前规则，changelog 按版本记录已核实的变更；两者不能互相替代。核对一条发布描述时，同时检查关联提交的 diff、该版本 tag 中的实现，以及当前代码和测试，避免仅依据提交标题断言某项能力已经发布。

编写说明时包含适用条件、输入或故障场景、必须保持的结果、源码符号和测试入口。例如“扩大采集窗后同一记录只计一次”，应同时指向 `parsedFullRescan` 和范围扩展测试，而不只写“修复统计问题”。

当前源码的改动先写入 changeset；只有生成并核实版本后才进入相应版本的 changelog。纯文档改动无需新建发版 changeset。源码链接及测试名随重命名同步更新，数字、平台范围和运行命令每次变更都要重新核对。

## Quotern 命名与升级兼容

产品名称为 `Quotern`，CLI 命令及 npm 包名为 `quotern`。内部包使用无 scope 的 `quotern-core`、`quotern-dashboard` 和 `quotern-desktop`；根私有 workspace 为 `quotern-workspace`。构建、CI、Changesets 和源码 import 应使用这些名称。

新后台服务使用 macOS `dev.quotern.cli`、Windows `quotern` 计划任务和 Linux `quotern.service`。注册或停止时一并清理旧名称的自启项；Desktop 接管时也会清理新旧 macOS / Windows CLI 自启项。桌面 `appId` 为 `dev.quotern.desktop`，Windows NSIS GUID 保持原安装身份，便于升级。

统计仍保存在 `~/.quotern/`。设备身份路径的回退规则见[架构注意事项](./architecture-notes.md)。桌面启动会复用已有旧 userData，以保留主题、托盘设置、浏览器存储及更新恢复标记；新安装使用新名称。旧标识仅用于升级兼容及历史发布记录。

源码、下载与发布目标统一为 `yuhengqin/Quotern`。桌面更新读取随安装包生成的 GitHub 配置及 Release 附件；源码不维护静态更新清单。私有仓库更新凭据由客户端环境提供，说明见 [Desktop 自动更新发布](../apps/desktop/README.md#自动更新发布)。

## 界面与文档用词

分享用量报告的内置背景与自定义图片使用同一内容布局，背景来源与内容配色分别传给预览和导出。自定义背景在本地选择 PNG / JPEG / WebP（原图不超过 20 MB、4000 万像素），按 2:3 裁剪并压缩为 1440 × 2160 JPEG（每张不超过 2 MB）；仅保存裁剪结果，不保留原文件路径或原图。

内置背景、自定义缩略图与「＋ 上传图片」统一放在背景选择栏。删除入口只显示在当前自定义背景的大预览右上角，桌面鼠标悬停或键盘聚焦时显示，触屏始终可见；确认删除后才更新图库。该入口位于预览内容之外，不进入下载或复制的图片。

图库最多三张。第四张完成裁剪后须明确选择替换对象，默认建议最久未使用的一张；新增、替换和删除都在持久化成功后更新图库。每次打开分享默认使用最新保存的自定义背景，手动选择旧图只更新使用时间。

背景图库由 Core 保存在 `dataDir/share-backgrounds/`（默认 `~/.quotern/share-backgrounds/`）：`index.json` 保存元数据及迁移收据，图片按内容哈希保存为独立二进制文件。浏览器走 HTTP，Desktop 走通用 local-api IPC，访问同一数据目录的所有端共享素材；当前选择属于各自分享会话。读写均使用独立跨进程文件锁，CLI observer 和 Desktop 并行使用时不会覆盖彼此的修改。打开分享或窗口重新获得焦点时自动读取最新图库，裁剪和上传期间暂停自动刷新；仅在读取失败或迁移未完成时显示对应重试入口。

首次在原浏览器、原地址打开分享时，会读取旧 IndexedDB `quotern-share-backgrounds`；Desktop 读取旧 userData 的 `share-backgrounds.json`。有空位时自动导入，按图片内容去重并保留时间，满额的图片显示待迁移提示，用户删除不需要的共享背景后可「重试迁移」。旧 IndexedDB / JSON 始终保留为备份；Core 记录已迁移图片的内容收据，重试或删除已导入图片后重新打开，不会重复导入或复活。旧源读取失败不影响已有共享图库。不同浏览器及不同 origin 的旧数据只能由对应浏览器和地址读取，需分别打开一次。备份新图库时复制整个 `share-backgrounds/`，不要只复制索引。

产品定位和介绍统一使用「Coding Agent」；界面标题、筛选、图表、分享和诊断中的简短称呼使用「Agent」，表示 Codex、Claude 等产品系列的用量来源类型，包含 CLI、IDE、Desktop 等形态，计数不代表运行中的 Agent 实例数。

订阅功能按语义使用「订阅来源」（服务或读取来源）、「订阅额度卡片」（展示）和「订阅卡片开关」（显示配置）。「平台」用于 Windows、macOS 等操作系统；「工具调用」、工具栏、迁移工具和开发工具链按原义表述。历史发布记录及参考项目介绍保留原文。技术描述中的 `Tool` / `Platform` 符号、`source`、IPC channel、接口字段和存储键按实际代码名称引用。
