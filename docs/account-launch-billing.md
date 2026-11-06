# 账号启动与 Claude 实际消费

总览订阅额度区提供「监控目录」和「实际消费」入口，Dashboard 与 Desktop 分别使用本机 HTTP 和 IPC。

## 账号启动

在「监控目录」添加已登录的 Claude Code / Codex 配置目录，点击账号行的「使用此账号启动」，在本机主目录打开绑定该配置的新终端。暂停的目录不能启动，不复制登录凭据。

在当前项目工作时使用：

```sh
quotern launch claude
quotern launch codex
quotern launch claude --profile profile-12345678 --runtime desktop
quotern launch claude --cwd /path/to/project -- --model sonnet
```

`--profile` 对应本地额度配置 `profiles` 的 ID；省略时使用界面选择的默认配置，未设置默认则按 CLI 自身常规配置启动。`--runtime cli|desktop` 仅用于定位显式 profile 的来源，省略时优先当前采集所有者。`--data-dir` 可指定 Quotern 数据目录。

「设为启动默认」只影响 `quotern launch`，不改变直接执行 `claude` / `codex` 的行为，不切换已运行的会话。保存的目录被删除、暂停或改向后会报错，需重新选择。Windows 的 npm shim 支持引号、JSON 和空参数。

## Claude 自动换号

先选择默认 Claude 账号并刷新额度，待身份验证成功后启用「Claude 额度耗尽后自动换号」。默认关闭。只有正在采集的本机所有者可执行：当前已知共享额度耗尽，备用账号启用、身份不同、原生读数新鲜且有可用额度，并通过启动身份核验，才更新后续启动的默认账号。

未知/过期额度、仅第三方观测、暂停、失去所有权或隔离开发均不触发。界面保留最近自动切换的时间和账号；保持 Quotern 采集运行才能执行。

## 实际消费

- **Claude.ai**：额外用量已消费、月度上限、赠送余额和累计赠送。
- **Anthropic Console**：组织账期消费、预付余额、默认工作区的当月明细；可按日、模型、API key 查看。组织消费和工作区明细范围不同，不强求总额相等。

点击「连接」，在对应网站登录后，从浏览器开发者工具的存储 / Cookie 复制 `sessionKey`，或粘贴 Cookie 请求头；点击「读取组织」，选择组织后保存。两个站点的登录独立，不自动提取浏览器 Cookie，不接收自定义上游地址。

Windows 用当前用户 DPAPI 加密；macOS/Linux 用 0700 私有目录和 0600 文件。凭据及缓存位于数据目录的 `billing-private/`，不在 Quotern 备份白名单中，也不经 GET 返回、不写入命令行或日志。「更新连接」替换登录或组织；「移除连接」清除该来源的凭据及缓存。

打开窗口按需刷新已有连接（60 秒内复用），也可手动刷新。已知零值显示 `$0`，未知显示 `—`；缺失明细标记已知小计。分项失败保留其上次读数和读取时间，其他分项继续更新。断开/替换不会被旧请求覆盖。

网站接口可能变化。登录过期或权限不足时更新连接；要求浏览器验证时先在对应站点完成验证；限流时稍后刷新。不绕过网站验证，不用本地估价填充实际账单。

## 技术与验收边界

固定域名 `claude.ai` / `console.anthropic.com`，只读 GET、禁止重定向，每请求 12 秒、2 MiB 上限。连接变更用文件锁及版本号提交。本地敏感入口验证 Host、Origin、连接来源及每运行实例的操作 token；演示模式不注册写入接口。

自动测试使用合成账号和账单，不消费真实额度；Windows CLI shim、原生程序参数和 DPAPI 已验证。真实网站登录和 macOS/Linux 原生终端仍需对应环境验证。网站读取契约参考仓库 Claude-Usage-Tracker；官方支持通过 [`CLAUDE_CONFIG_DIR`](https://code.claude.com/docs/en/authentication) 使用独立账号配置。

运行 `corepack pnpm test` 验证构建和各包测试；构建后运行 `node apps/desktop/scripts/run-account-billing-smoke.mjs`，验证 Dashboard / Desktop 的合成账号与账单流程、键盘焦点及窄屏布局，截图和结果保存在 `.quotern-dev/account-billing-ui-*`。Desktop 类型检查使用 `corepack pnpm --filter quotern-desktop typecheck`。
