---
name: quotern-usage
description: Query locally collected Coding Agent token usage, estimated costs, and model or project reports through the Quotern CLI. Use for questions about the user's collected AI usage and its pricing basis.
---

# Quotern usage queries

Use the installed `quotern usage` command and parse its JSON. This reads already persisted local data and works while Desktop owns collection; it does not require a web server.

```sh
quotern usage summary --days 7 --format json
quotern usage daily --from 2026-06-01 --to 2026-06-30 --format json
quotern usage models --days 30 --source codex,claude --format json
quotern usage projects --days 30 --project Quotern --format json
```

Periods: `summary` (default), `daily`, `weekly`, `monthly`, `models`, `projects`. Default range is 7 days including today. Dates are inclusive in `Asia/Shanghai`; weeks begin Monday. Use either `--days N` or both `--from YYYY-MM-DD --to YYYY-MM-DD`. Optional filters: `--source` (comma-separated), exact `--model`, normalized display-name `--project`. `--data-dir` explicitly selects an existing Quotern data directory. Use `--help` for command syntax; do not invent unsupported flags or a session report.

Read `schemaVersion` before interpreting the result (currently `1`). Preserve source/model identity: identical model names from different Agents are separate report rows. Projects use Quotern's display-name grouping, so same-named directories can be combined.

When answering:

- State the actual date range, filters and time zone. `coverage.snapshot: persisted` means data already written when queried, not a transactionally synchronized view of the live app. Mention `lastSyncAt` when freshness matters.
- Check `coverage.limited`, `collectSince` and `invalidRows`; zero rows do not prove no usage existed outside the collected range.
- `costUsd: null` means incomplete pricing. `knownCostUsd` is only the priced subtotal. Do not describe missing prices as free usage.
- Explain `costExplanation`: source-reported amount versus rate estimate, default-priced token share, missing prices, matched model, match method and price table. A reported amount may itself be a provider estimate; it is not proof of payment.
- Token provenance is independent of price provenance: `recorded`, `estimated`, `ledger`, `mixed`, `unknown`. Older records can be `unknown`; do not retroactively assert they were measured or estimated.
- Preserve null request/cache metrics as unknown. Do not infer request count from token events or treat missing cache evidence as zero reuse.

For a query, do not run `start`, `sync`, `service`, edit config, inspect raw conversation logs, or widen the collection range. If the executable/config is missing or a query fails, report that limitation and the relevant setup need; do not initialize or repair data implicitly. Never return credentials or unrelated local files.
