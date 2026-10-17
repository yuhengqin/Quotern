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

## Present results

- Lead with the answer and its most useful supported finding, with the date range, active filters and time zone nearby. Match the user's language. For token-only questions, keep pricing details out unless requested.
- Give the overview and evidence different jobs: the overview explains a meaningful relationship or implication; tables and metric cards carry the detailed values. Avoid repeating the same totals and rankings in several adjacent summaries.
- Match depth to the question: a single metric usually needs a short paragraph; a ranking needs a brief overview, a sorted table and a short scope note; a trend may benefit from a line chart. Aim for a 30–60 second read for routine queries while preserving requested detail. Use horizontal bars when a chart makes category rankings easier to compare; reserve a full report for a request that needs one.
- Sort rankings by the requested metric and retain source/model identity and all requested rows. Add a share column when it helps comparison. An explicit top-N request may limit rows; label its scope rather than presenting it as the complete distribution.
- Use one clearly labeled unit per numeric column, such as `Token (M)` with `1 M = 1,000,000 Token`. Narrative text can use familiar units such as 亿. Round only for display; retain enough precision or use a bound such as `<0.01%` so small nonzero values remain visible. Give exact values when requested or when precision changes the interpretation.
- Calculate shares and concentration from unrounded returned values with a calculator or code, using the reported total for the same period and filters. Label a different denominator explicitly. Preserve reported totals rather than summing rounded displays; when the total is zero, omit percentages.
- Add one or two observations when the returned data supports something useful beyond reading the table, such as concentration or token composition. Briefly explain why it matters. If cache reads dominate, explain that total tokens include cache reads; `cacheReadTokens / tokens` is a composition share, not a cache hit rate. Keep unknown cache-hit metrics unknown.
- Ground each interpretation in available evidence: period changes need comparable periods, trends need time-series data, and cost claims need cost data. Token volume alone does not establish productivity, value, waste or a reason to switch models. Ordinary lookups need no extra queries just to manufacture insights or recommendations.
- Keep scope and freshness notes brief; put incomplete coverage or pricing next to the claim it qualifies. Expand limitations that change the answer, rather than listing every successful validation check. Use concrete, plain language; keep tool commands, JSON field names and process notes out of the reply unless they help the user verify the answer or were requested.

For a model ranking, single-cost query or incomplete-data answer, consult [response examples](references/response-examples.md) for the matching response shape. The examples use synthetic data; adapt their structure and use only the current query's facts.

## Deliver a complete HTML report

For a requested report, weekly/monthly review, exportable/shareable result, or substantial analysis whose charts and detail would overwhelm chat, follow [HTML reports](references/html-reports.md). Use the bundled Node.js renderer and fixed template to produce a self-contained local HTML file: overview, supported findings, distribution or time chart, every returned detail row, and data scope. The renderer accepts existing CLI JSON; Core continues to own statistics. Ordinary short lookups stay in chat, and an explicit chat-only request takes precedence.

Write brief, evidence-backed analysis annotations; let the template handle layout. Verify and preview the file where browser tools are available, then deliver a short chat summary and an absolute file link. The HTML file carries the complete detail; the chat highlights the answer, a useful finding and any limitation that changes interpretation. Include costs only when requested. Node.js is already required by Quotern; no extra packages or local server are needed.

## Interpret data correctly

- `coverage.display` timestamps already use the report time zone. Preserve the instant and time zone while allowing readable formatting, such as `10 月 17 日 16:55（北京时间）`; retain the date/year when needed to disambiguate. Do not parse an already-local display timestamp as UTC. Raw timestamps ending in `Z` are UTC: convert with a timezone-aware library before labeling them local, or quote the original with its UTC label.
- `lastSyncAt` is the most recent successful source-sync completion, even when it added no data. `readAt` is report construction time. Neither proves every source is up to date. `snapshot: persisted` means already written data, not a transactionally synchronized live view.
- Check `coverage.limited`, `collectSince` and `invalidRows`. Zero rows do not prove no usage outside the collected range. `invalidRows` counts rejected bucket objects; malformed JSONL can be skipped earlier, so zero is not proof that all stored records are valid.
- `costUsd: null` means incomplete pricing. `knownCostUsd` is only the priced subtotal. Do not describe missing prices as free usage.
- When discussing costs, distinguish source-reported amounts from rate estimates and disclose default pricing or missing prices. Explain matched model, method and price table from full JSON when needed. A reported amount may itself be a provider estimate, not proof of payment.
- Token provenance is independent of price provenance: `recorded`, `estimated`, `ledger`, `mixed`, `unknown`. `unknown` means a valid metering provenance label is absent, not that the totals are wrong, estimated, or necessarily old. Prefer “部分记录缺少计量来源标签，无法进一步区分记录方式。” Mixed buckets cannot be split retrospectively.
- Preserve null request/cache metrics as unknown. Do not infer request count from token events or treat missing cache evidence as zero reuse.

For a query, do not run `start`, `sync`, `service`, edit config, inspect raw conversation logs, or widen the collection range. If the executable/config is missing or a query fails, report that limitation and the relevant setup need; do not initialize or repair data implicitly. Never return credentials or unrelated local files.
