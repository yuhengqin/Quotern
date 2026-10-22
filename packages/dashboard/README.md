# quotern-dashboard — React 面板

AI 用量看板前端。构建产物为纯静态 `dist/`，主要随 CLI 一起分发：
`pnpm build:cli` 会把 `dist/**` 复制进 `packages/cli/dist/dashboard/`，
由 `quotern start` 内置 HTTP 服务托管。

## 构建

```bash
pnpm --filter quotern-dashboard build
```

- `build` 面向 CLI 托管：根路径 `/`，API 使用本地 `/functions/tud-*`
- 发 CDN 时可设 `PUBLIC_PATH`（优先于 `VITE_BASE`）覆盖静态资源前缀，见 [.env.production.example](./.env.production.example)
- 本地 UI review 需要假数据时：`VITE_ENABLE_MOCK_DATA=true pnpm --filter quotern-dashboard dev`

## 开发

```bash
# 仓库根一键：API（CLI :8252）+ Vite HMR（:5194）
pnpm dev:cli

# 或单独起面板（dev:cli:ui 等价）
pnpm --filter quotern-dashboard dev

```

独立启动 Vite 时需已有 CLI 在 `:8252` 提供 API。修改共享 UI 或数据层时同时核对 `apps/desktop/src/renderer` 的同名副本，见[架构注意事项](../../docs/architecture-notes.md)。
