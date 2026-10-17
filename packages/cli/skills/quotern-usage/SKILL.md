---
name: quotern-usage
description: Use for questions about the user's locally collected Coding Agent token usage, estimated costs, model or project reports, and pricing basis. Not needed for general explanations of tokens or model pricing without a personal usage query.
---

# Quotern usage queries

Use the installed `quotern usage` command and parse its JSON. Core defines statistics, CLI presents them, and this Skill selects queries and explains results. Queries read persisted local data, work while Desktop owns collection, and require no web server.

```sh
quotern usage models --days 7 --format json --compact
quotern usage daily --from 2026-06-01 --to 2026-06-30 --format json --compact
quotern usage projects --days 30 --project Quotern --format json --compact
```

Periods: `summary` (default), `daily`, `weekly`, `monthly`, `models`, `projects`. Default range is 7 days including today. Dates are inclusive in `Asia/Shanghai`; weeks begin Monday. Use either `--days N` or both `--from YYYY-MM-DD --to YYYY-MM-DD`. Optional filters: `--source` (comma-separated), exact `--model`, normalized display-name `--project`. `--data-dir` explicitly selects an existing Quotern data directory. Use `--help` for command syntax; do not invent unsupported flags or a session report.

Prefer one compact query for totals and rankings. `schemaVersion: 1`, `view: compact` keeps dates, filters, coverage, summary details and each group's totals, cost subtotals and provenance. Per-row token components/local metrics and detailed price matching entries require full JSON: omit `--compact` when the question needs them. If an older CLI explicitly rejects `--compact` as unknown, retry once without it; other failures follow the read-only failure rule below. Do not silently interpret an unsupported schema version.

Preserve source/model identity: identical model names from different Agents are separate report rows. Projects use Quotern's display-name grouping, so same-named directories can be combined. Use the reported totals; do not reimplement aggregation or derive costs from token shares.

When answering:

- Lead with the requested date range, filters, time zone and results. For token-only questions, keep pricing details out of the answer unless they are requested.
- Quote `coverage.display` timestamps directly; they already include the report time zone. Raw timestamps ending in `Z` are UTC. For full/older JSON, convert with a timezone-aware date library before labeling them local, or quote the original with its UTC label.
- `lastSyncAt` is the most recent successful source-sync completion, even when it added no data. `readAt` is report construction time. Neither proves every source is up to date. `snapshot: persisted` means already written data, not a transactionally synchronized live view.
- Check `coverage.limited`, `collectSince` and `invalidRows`. Zero rows do not prove no usage outside the collected range. `invalidRows` counts rejected bucket objects; malformed JSONL can be skipped earlier, so zero is not proof that all stored records are valid.
- `costUsd: null` means incomplete pricing. `knownCostUsd` is only the priced subtotal. Do not describe missing prices as free usage.
- When discussing costs, distinguish source-reported amounts from rate estimates and disclose default pricing or missing prices. Explain matched model, method and price table from full JSON when needed. A reported amount may itself be a provider estimate, not proof of payment.
- Token provenance is independent of price provenance: `recorded`, `estimated`, `ledger`, `mixed`, `unknown`. `unknown` means a valid metering provenance label is absent, not that the totals are wrong, estimated, or necessarily old. Prefer “部分记录缺少计量来源标签，无法进一步区分记录方式。” Mixed buckets cannot be split retrospectively.
- Preserve null request/cache metrics as unknown. Do not infer request count from token events or treat missing cache evidence as zero reuse.

For a query, do not run `start`, `sync`, `service`, edit config, inspect raw conversation logs, or widen the collection range. If the executable/config is missing or a query fails, report that limitation and the relevant setup need; do not initialize or repair data implicitly. Never return credentials or unrelated local files.
