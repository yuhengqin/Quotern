# 发版与里程碑规范

面向维护者。贡献者只需要看 [Changeset 怎么写](#changeset-怎么写) 一节。

版本遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

## 版本策略

四个包由 [Changesets](https://github.com/changesets/changesets) 管理，各自独立升版，不强制对齐：

| 包 | 路径 | 发布方式 |
| --- | --- | --- |
| `quotern` | `packages/cli` | npm |
| `quotern-core` | `packages/core` | npm |
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
pnpm version-packages   # changeset version：消费 .changeset/*，更新各包 package.json 与 CHANGELOG.md
```

**必须人工 review 生成的 `CHANGELOG.md`。** changesets 会原样搬运 changeset 描述，措辞问题在这一步改掉，不要等发布后再返工。

核对条目时检查提交 diff、目标版本源码及测试，不把提交标题当作功能已生效的证据。平台、来源目录、参数格式和费用口径应有明确限定；尚未发布的修改保留在 changeset 中。

以 `chore(release): version packages` 提交，走 PR 合入 `main`。

### 2. 打 tag

```bash
git tag v0.2.0 && git push origin v0.2.0
```

tag 与里程碑同名。

### 3. 发布产物

```bash
pnpm release                 # 构建 CLI 并 changeset publish 到 npm
pnpm release:desktop:mac     # electron-builder → 上传至 GitHub Release
pnpm release:desktop:win
```

`electron-builder.yml` 的 publish 目标是 GitHub，安装包会自动挂到对应 tag 的 Release 上。

### 4. 撰写 GitHub Release

按下方模板填写正文。两个平台的安装包及更新清单上传并验收完成后，发布 GitHub Release。

### 5. 确认自动更新源

Desktop 使用 [electron-builder.yml](./apps/desktop/electron-builder.yml) 的 GitHub `publish` 配置作为发布与运行时更新目标；构建生成的 `app-update.yml` 随安装包分发。

检查 GitHub Release 附件中对应平台与通道的更新 yml，确认版本、`files.url`、文件大小、SHA-512 校验和与实际附件一致。私有仓库还需验证客户端凭据能读取 Release 和附件。按平台分别验收；便携版应提示手动下载，不能安装 NSIS 包。具体操作见 [Desktop 自动更新发布](./apps/desktop/README.md#自动更新发布)。

## Release 正文模板

正文格式：一条一句话，句首用 emoji 标类型，句末带 PR 链接与贡献者。按端分组，端内按重要程度排序 —— 用户最可能关心的放最前面。

emoji 与 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)的分类保持一致：🆕 新功能、🐞 修复、🔌 数据源、💄 样式交互、⚡️ 性能、🛠 重构、🤖 类型、📝 文档、📦 构建、🔒 安全。

```markdown
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
| macOS (Apple Silicon) | 见下方附件 `*-arm64.dmg` |
| macOS (Intel) | 见下方附件 `*.dmg` |
| Windows | 见下方附件 `*-setup.exe` |
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
