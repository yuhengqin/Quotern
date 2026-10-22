# 发版与里程碑规范

面向维护者。贡献者只需要看 [Changeset 怎么写](#changeset-怎么写) 一节。

版本遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

## 版本策略

五个包由 [Changesets](https://github.com/changesets/changesets) 管理，各自独立升版，不强制对齐：

| 包 | 路径 | 发布方式 |
| --- | --- | --- |
| `quotern` | `packages/cli` | npm |
| `quotern-core` | `packages/core` | npm |
| `quotern-i18n` | `packages/i18n` | npm，CLI 与桌面端的共享翻译依赖 |
| `quotern-dashboard` | `packages/dashboard` | `private`，静态产物随 CLI 分发 |
| `quotern-desktop` | `apps/desktop` | `private`，产物为 dmg / exe |

`.changeset/config.json` 中 `updateInternalDependencies: patch`，因此 core 一升版，依赖它的三个包会自动收到 patch 级联。

版本号含义：

- **patch** — Bug 修复、文案与样式微调、依赖升级、新增数据源解析器（不改变已有行为）
- **minor** — 新功能、新增 CLI 参数或面板能力、向后兼容的增强
- **major** — 破坏性变更：删改 CLI 参数、变更 `~/.quotern/` 数据结构、变更对外 API

> 破坏性变更必须在 changeset 描述里以 `**Breaking:**` 开头，并在 PR 正文中写明迁移方式。

## Changeset 怎么写

每个影响用户的 PR 都要带 changeset。纯文档、CI、注释改动可以跳过。

```bash
pnpm changeset
```

按提示选包 → 选 patch / minor / major → 写描述，会在 `.changeset/` 下生成一个 markdown 文件，**和代码一起提交**。

描述遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的原则：**写这个改动对用户产生了什么影响，而不是你怎么实现的。**

| ❌ 不要这样写 | ✅ 这样写 |
| --- | --- |
| 重构 pricing 匹配逻辑 | 修复 Cursor 模型被误判为 MiniMax 导致费用偏高 |
| 加了个 useMemo | 修复模型筛选项在名称重复时重复渲染 |
| 修改 SettingsPanel 样式 | 统一 Desktop 与浏览器面板的设置弹窗样式 |

跨端改动要在描述里点明范围，例如「Desktop 与 Web 面板同步修复」。

## 里程碑（Milestone）

一个里程碑对应一次 minor 发布，命名与 tag 一致：`v0.2.0`、`v0.3.0`。

**该挂里程碑的：**

- 计划在该版本内交付的需求 issue 及其 PR
- 阻塞发布的 Bug：崩溃、数据错误、回归

**不该挂的：**

- 提问、使用求助、暂无排期的需求 —— 留在 backlog，不要为了「看起来有规划」塞进里程碑
- 随时可发的 patch 修复

**关闭条件：** 里程碑下所有 issue 已关闭或改挂下一个里程碑，且对应 tag 已发布。发版时未完成的条目一律顺延，保证「里程碑关闭 = 版本已发布」这个等式始终成立。

## 发版流程

### 1. 生成版本号与 changelog

```bash
corepack pnpm version-packages   # changeset version：消费 .changeset/*，更新各包 package.json 与 CHANGELOG.md
```

**必须人工 review 生成的 `CHANGELOG.md`。** changesets 会原样搬运 changeset 描述，措辞问题在这一步改掉，不要等发布后再返工。

核对条目时检查提交 diff、目标版本源码及测试，不把提交标题当作功能已生效的证据。平台、来源目录、参数格式和费用口径应有明确限定；尚未发布的修改保留在 changeset 中。

同时按[下方模板](#release-正文模板)整理 `docs/release-notes/v<Desktop版本>.md`，例如 `v0.2.0.md` 或 `v0.2.0-beta.1.md`。版本文件面向用户说明本次发布重点、升级事项和下载方式，各包 CHANGELOG 继续保留完整历史。文件名与稍后创建的 tag 一致，内容必须对应这一版本的真实变更。

将版本号、CHANGELOG 和发布说明一起以 `chore(release): version packages` 提交，走 PR 合入 `main`；发布说明必须已经包含在被打 tag 的提交中。

### 2. 打 tag

```bash
git tag v0.2.0 && git push origin v0.2.0
```

tag 与里程碑同名。

### 3. 构建与验收产物

```bash
corepack pnpm release                 # 维护者单独补发 CLI / core / i18n 到 npm；正式 Release 通常自动发布
corepack pnpm release:desktop:mac     # 在 macOS 以 ad-hoc 构建、验证；不上传
corepack pnpm release:desktop:mac:signed # Developer ID 签名、公证与验证；不上传
corepack pnpm release:desktop:win     # 在 Windows 构建与验证；不上传
```

Desktop 使用下方统一流程。平台命令只在本地生成产物；`electron-builder.yml` 的 `publish` 保留为运行时更新源配置，不负责直接上传。

### 4. 生成与审阅 GitHub Release

统一流程验证通过后，可显式创建草稿。workflow 自动将 tag 对应的 `docs/release-notes/<tag>.md` 导入正文，无需在 GitHub 页面重复粘贴。核对草稿附件、实机验收与正文后人工发布；发布 GitHub Release 会自动触发下方的 npm 发布工作流。推 tag 或默认手动运行不会创建 Release，也不会发布 npm 包。修改仓库中的说明文件不会自动同步到已经创建的草稿或正式 Release，需显式更新其正文。

### 5. 确认 npm 发布

检查 Actions 中 `npm release publication` 的结果，确认三个 npm 包的目标版本均可公开安装。GitHub Release 发布成功不代表 npm 上传成功；任一包上传或安装验收失败时，该工作流会失败，应按下方说明处理。

### 6. 确认自动更新源

Desktop 使用 [electron-builder.yml](./apps/desktop/electron-builder.yml) 的 GitHub `publish` 配置作为发布与运行时更新目标；构建生成的 `app-update.yml` 随安装包分发。

对支持自动更新的产物，检查 GitHub Release 附件中对应平台与通道的更新 yml，确认版本、`files.url`、文件大小、SHA-512 校验和与实际附件一致。macOS ad-hoc 版本仅手动更新，不上传 macOS 更新 yml / blockmap。私有仓库还需验证客户端凭据能读取 Release 和附件。按平台分别验收；Windows 便携版应提示手动下载，不能安装 NSIS 包。具体操作见 [Desktop 自动更新发布](./apps/desktop/README.md#自动更新发布)。

## npm 发布与验收

入口为 [release-npm.yml](./.github/workflows/release-npm.yml)，只订阅 GitHub Release 的 `published` 事件。创建草稿、推 tag 和普通构建不会触发 npm 发布；人工发布正式版或 Pre-release 后，工作流固定检出该事件的 commit，核对 tag、Desktop 源码版本与 commit，再构建并发布 npm 包。[GitHub 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)。

工作流只处理 `quotern-core`、`quotern-i18n`、`quotern`，继续使用 Changesets 管理的各包独立版本。正式版使用 `latest`；带预发布版本号且在 GitHub 标记为 Pre-release 的版本使用 `next`，不更新 `latest`。正式版拒绝包含预发布 npm 版本。发布使用 pnpm 的递归发布能力，自动跳过已经存在的同名同版本包，因此只有 Desktop 变化时不必额外升 npm 版本；失败后重新运行工作流可补发尚未成功的包，不覆盖已有版本。[pnpm 发布行为](https://pnpm.io/cli/publish)。

正式发布会在上传前检查 registry 的 `latest`，拒绝将其回退到较旧的包版本；上传后为此前只在 `next` 的稳定版本补齐 `latest`，无需重复上传。重新运行历史 Release 若会回退通道，将失败并保留当前线上版本。

首次使用前，在 npm 网站头像菜单的 **Access Tokens → Generate New Token** 创建 granular access token，权限选择 **Read and write (publish and stage)**，启用 **Bypass two-factor authentication**，授权范围覆盖这三个包，设置有效期后生成。首次发布的账号还须能创建对应包。将完整 Token 直接存入 GitHub 仓库 **Settings → Secrets and variables → Actions** 的 `NPM_TOKEN` Secret。Token 仅在上传步骤注入 `NODE_AUTH_TOKEN`，不提供给依赖安装、构建或测试步骤；需要在过期前更新 Secret。[npm Token 创建说明](https://docs.npmjs.com/creating-and-viewing-access-tokens/)、[CI/CD 认证说明](https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow/)。

截至 2026-10-22，npm 已公告计划于 **2027 年 1 月**移除 granular access token 的直接发布能力；当前流程仍可使用上述 Token，此后需迁移到 trusted publishing（OIDC），或改为 staged publishing 并由维护者审批。更新发布认证时以 [npm 官方政策](https://docs.npmjs.com/about-access-tokens/#direct-publishing-is-being-deprecated)为准。

发布前执行发版回归测试、CLI / core / i18n 测试和 CLI 构建（包含 Dashboard），再用 `pnpm pack` 生成三个包，检查入口、网页与 Skill 文件、版本身份和内部依赖，拒绝残留 `workspace:` / 本地路径依赖。在仓库外的临时项目安装 tarball 并调用实际生成的 `quotern help`，确认安装结果不依赖源码工作区。上传后再从公共 npm registry 安装精确版本并复查入口和文件；构建包、校验报告和发布摘要保留在 `npm-release-evidence` artifact 中。

本地可先运行相同的包检查，不需要 npm 发布凭据：

```bash
corepack pnpm build:cli
corepack pnpm check:npm-release
```

该检查会在临时目录生成 tarball、安装依赖并运行帮助命令，不发布、不启动采集、不修改用户配置。检查线上已发布版本时使用 `corepack pnpm check:npm-release --registry-smoke`。这些检查验证包的安装与文件完整性，不替代系统服务或面板交互的实机验收。

npm 不支持跨包原子发布。某个包已上传而后续步骤失败时，保留已有版本并重新运行失败的工作流；若发现已发布内容有误，修复后提升包版本，不能尝试覆盖原版本。首次发布、Token 权限和真实 registry 验收须在 GitHub Actions 实际运行后确认。

## Desktop 统一构建与验收

入口为 [release-desktop.yml](./.github/workflows/release-desktop.yml)。`v*` tag push 和 Actions 手动运行默认只验证，不上传 GitHub Release。Windows、macOS、源码归档三个任务全部成功后，汇总任务再次校验实际文件、更新清单、blockmap、版本和 commit，生成 `desktop-release-verified` artifact 及 `checksums-sha256.txt`。

macOS 使用明确的 `macos_signing` 选项：默认 `adhoc`，手动选择 `signed` 才启用 Developer ID 证书与公证。tag push 默认 `adhoc`；准备正式签名版时手动选择相同 tag 和 `signed`。模式不会根据 Secrets 是否存在自动切换。两种模式各自输出到 `apps/desktop/release/<version>/mac-adhoc/` 或 `mac-signed/`，文件名仍为 `Quotern-<version>-mac-<arch>.dmg/.zip`。单架构开发快捷命令 `build:desktop:mac:arm` 仅生成 ARM64 ad-hoc 测试包，不生成发布证明。

需要创建草稿时，在 Actions 手动运行该 workflow，选择与 `apps/desktop/package.json` 一致的 `v<version>` tag，显式勾选 `publish`。预检要求该 tag 的源码中存在非空的 `docs/release-notes/<tag>.md`，缺失或空白会在平台构建前失败；普通构建验证不强制要求说明文件。仅最后的 draft job 具有 `contents: write` 权限；它用 `--notes-file` 导入版本说明，只新建 Draft，不覆盖已有 Release，也不公开发布。预发布版本自动标记 Pre-release。普通分支不能创建草稿；任何平台或源码验证失败都会阻止汇总与上传。草稿经人工发布后，由 `release-npm.yml` 自动执行 npm 发布与安装验收。

### macOS ad-hoc 模式

无需 Apple Developer 会员及下表中的 Apple Secrets。脚本创建并清理自有空 keychain，隔离已有证书和签名环境变量，显式采用 `identity=-`，关闭 hardened runtime、公证和 DMG 外壳签名。内部 `.app` 及嵌套原生代码仍需有效的 ad-hoc 签名。

验收覆盖原应用、ZIP 解压后的应用和只读挂载 DMG 内的应用：`codesign --verify --deep --strict`、实际 `Signature=adhoc`、嵌套代码签名身份、bundle 版本、Electron / Sharp / libvips 架构和包内 `quoternMacosReleaseMode=adhoc` 标记；DMG 仍执行 `hdiutil verify`。不要求 Gatekeeper 放行或公证装订，也不会在报告中把这些步骤标记为已通过。验证报告明确记录 `mode=adhoc`、`updatePolicy=manual`、`notarized=false`。

此模式保留四份 DMG/ZIP 和最终文件哈希，但清理并拒绝 macOS 自动更新 yml / blockmap。应用设置和顶部入口显示手动下载，不请求自动更新服务、不下载或安装更新。正式签名的旧版本、Windows 安装版和 Windows 便携版保持各自原有行为。发布说明应明确该版本未公证、需要手动更新及首次启动限制；可引用 [Apple 的打开应用说明](https://support.apple.com/en-us/102445)。

本机复核已有完整目录使用 `corepack pnpm verify:desktop:mac --dir <目录>`。汇总 ad-hoc 产物时使用 `corepack pnpm assemble:desktop --macos-mode adhoc --input <输入目录> --output <新输出目录>`；传错模式会失败。

### macOS 正式签名和公证

选择 `signed` 模式时，在 GitHub 仓库 Secrets 配置以下内容；该模式的构建验证同样需要凭据，缺失会失败，不会回退 ad-hoc：

| Secret | 内容 |
| --- | --- |
| `MAC_CERTIFICATE_BASE64` | 包含私钥的 **Developer ID Application** `.p12` 的 Base64 内容 |
| `MAC_CERTIFICATE_PASSWORD` | 导出 `.p12` 的密码，可为空 |
| `APPLE_ID` | Apple 开发者账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 账号的 App 专用密码 |
| `APPLE_TEAM_ID` | 预期签名团队的 10 位 Team ID |

workflow 将证书导入临时 keychain，将公证凭据存入该 keychain 的 `quotern-release` profile；任务结束总会删除 keychain 和证书文件并还原搜索列表。证书用途、有效期、Team ID 与私钥必须匹配。凭据不写入仓库或发布附件。设置方法可参考 [GitHub 的 macOS 签名指南](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)。

本机可使用已解锁 keychain 中的证书，并设置 `APPLE_TEAM_ID` 与以下任意一组公证凭据（只选一组）：`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`；`APPLE_API_KEY`（文件路径）+ `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`；或 `APPLE_KEYCHAIN_PROFILE`（可另设 `APPLE_KEYCHAIN`）。证书在非默认 keychain 时设置 `CSC_KEYCHAIN`。缺少凭据、临时签名、开发证书或错误团队均不能通过正式验收。

`release:desktop:mac:signed` 一次打包 ARM64 和 x64，保持独立 `.dmg` / `.zip`。应用要求 distribution 签名、hardened runtime 和公证；DMG 也单独签名、公证与装订。验收覆盖原应用、ZIP 解压后的应用和只读挂载 DMG 内的应用，执行 `codesign`、`spctl`、`stapler`，检查 bundle 版本、Electron 与原生解码库的架构，并校验包内 `quoternMacosReleaseMode=signed` 与自动更新策略。失败即停止。Apple 返回已知 submission ID 后，临时等待错误只对该 ID 重试，拒绝结果不重试。

DMG 装订会修改文件；脚本在全部验收后重建四份 blockmap 和 `latest-mac.yml`，预发布同时生成内容一致的 `beta-mac.yml` 与 `latest-mac.yml`，兼容当前客户端及私有 GitHub provider。Windows 预发布同样保留 `beta.yml` / `latest.yml`。随后校验最终大小、SHA-512，生成绑定文件哈希和 `mode=signed` 的 `macos-verification.json` 与 `mac-artifacts.json`。禁止验收后重新签名、装订或改包而沿用旧清单。已有完整打包目录可用 `corepack pnpm verify:desktop:mac:signed --dir <目录>` 重新执行 Apple 验收；此命令仍需要 macOS 和凭据。汇总 signed 产物时显式传 `--macos-mode signed`。

### Windows 与源码归档

Windows 同时生成 x64 / ARM64 的 NSIS 安装版、便携版，安装器语言和交互沿用现有设置。校验四份 EXE、两份安装版 blockmap、更新清单及哈希，生成 `win-artifacts.json`；便携版不进入安装版自动更新清单。客户端在开始下载前按运行架构筛选安装版，避免私有 GitHub 的无扩展名附件 API URL 让更新库回退选择 x64。Windows 代码签名凭据尚需发布者配置并验收，本次统一流程没有替代 Windows 签名和两种架构的实机安装、启动、升级测试。

源码任务对精确 HEAD 执行 `git archive`，在仓库外解压、不带 `.git`，重新安装依赖、检查工作区链接、完整构建并执行 Desktop 类型检查，输出 `source-archive.json`。汇总要求报告中的版本和 commit 与两平台一致。本地 `--working-tree` 模式只做未提交源码验证，其报告不能用于发布汇总。用户构建说明见 [CONTRIBUTING](./CONTRIBUTING.md#从-source-code-归档构建)。GitHub 自动附加的 Source code zip / tar.gz 是 tag 快照，不包含安装包、依赖和 Git 历史；无须额外上传同名源码文件。

发布前仍需实机验证 macOS 两种芯片的安装/启动/升级、Windows 两种架构的向导/便携/更新流程，以及私有仓库凭据和预发布转正式版路径。Actions 的签名与架构检查不等于完整实机验收。

## Release 正文模板

正文格式：一条一句话，句首用 emoji 标类型，句末带 PR 链接与贡献者。按端分组，端内按重要程度排序 —— 用户最可能关心的放最前面。

emoji 与 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)的分类保持一致：🆕 新功能、🐞 修复、🔌 数据源、💄 样式交互、⚡️ 性能、🛠 重构、🤖 类型、📝 文档、📦 构建、🔒 安全。

```markdown
# Quotern v0.2.0

## 🖥️ Desktop

- 🆕 新增 xxx。[#123](https://github.com/yuhengqin/Quotern/pull/123) [@someone](https://github.com/someone)
- 🐞 修复 xxx 导致 xxx 的问题。[#124](https://github.com/yuhengqin/Quotern/pull/124) [@someone](https://github.com/someone)

## ⌨️ CLI

- 🔌 新增 xxx 数据源解析支持。[#125](https://github.com/yuhengqin/Quotern/pull/125) [@someone](https://github.com/someone)

## 🌐 Web

- 💄 优化 xxx 的展示。[#126](https://github.com/yuhengqin/Quotern/pull/126) [@someone](https://github.com/someone)

## 📦 下载

| 平台 | 获取方式 |
| --- | --- |
| macOS (Apple Silicon) | `Quotern-<version>-mac-arm64.dmg` / 同名 `.zip` |
| macOS (Intel) | `Quotern-<version>-mac-x64.dmg` / 同名 `.zip` |
| Windows x64 | 安装版 `*-win-x64-setup.exe` / 便携版 `*-win-x64-portable.exe` |
| Windows ARM64 | 安装版 `*-win-arm64-setup.exe` / 便携版 `*-win-arm64-portable.exe` |
| CLI | `npm i -g quotern` |

**Full Changelog**: https://github.com/yuhengqin/Quotern/compare/v0.1.6...v0.2.0
```

若某一端本次无改动，删掉对应分组，不要留空标题。

## 标签约定

| 标签 | 用途 |
| --- | --- |
| `type: bug` | 已确认的缺陷 |
| `type: feature` | 新功能与增强 |
| `type: docs` | 文档 |
| `surface: desktop` / `surface: cli` / `surface: web` | 受影响的端，与分支命名的 `<end>` 保持一致 |
| `need more info` | 缺少复现信息，等待作者补充；14 天无回应则关闭 |
| `good first issue` | 适合新贡献者，issue 内需写清楚要改哪些文件 |
| `help wanted` | 欢迎社区认领 |
| `duplicate` / `wontfix` | 关闭前必须说明理由并给出指向 |
