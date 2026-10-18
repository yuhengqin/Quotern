# Usage Analysis Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for root implementation; read-only scouts, mechanical mirroring and independent verification follow AGENTS.md role constraints.

**Goal:** Deliver the five approved second/third-batch usage-analysis capabilities across Core, CLI and both clients.

**Architecture:** Extend existing session observations for request evidence and details. Add an exact bucket-based trend API and a shared chart surface. Keep statusline read-only and reuse pricing/report logic.

**Tech Stack:** TypeScript, Node, Hono, React, HeroUI v3, Recharts.

**Spec:** docs/superpowers/specs/2026-10-18-usage-analysis-design.md

## Global Constraints

- Dashboard and Desktop stay behaviorally aligned; IPC transport remains intact.
- Never reconstruct session identity or per-request thresholds from half-hour totals.
- Missing costs are unknown, source amounts are not necessarily invoices.
- No unsolicited hook registration, network calls or production-runtime takeover.

## Review Focus

- Date/source changes must not display stale asynchronous results.
- Cross-midnight sessions and task clocks use the selected window consistently.
- Historical observations without new fields retain totals and explicit missing details.
- Streaming/duplicate records and tier changes cannot double-count usage.
- Terminal input is bounded and sanitized; zero costs remain valid.

### Task 1: Exact trends

- [x] Add failing tests for `aggregateUsageTrend(rows, query, context)` in core/test/usage-trend.test.ts: distinct model rates, source filters, multi-day hours, Monday weeks, clipped months, zero fill and partial pricing.
- [x] Implement core/src/usage-trend.ts, export types, register GET /functions/tud-usage-trend with validated query and collectSince floor.
- [x] Compile Core and run the new tests and API tests.

### Task 2: Request evidence and session details

- [x] Add tests for persisted optional Token splits, per-model details, legacy coverage, TTL normalization, range and fork isolation.
- [x] Extend session-observation.ts with numerical details and pure per-model aggregation, share selected events with existing totals, add timing in local-api.ts, bump collector schema preserving schema 9 reads.
- [x] Implement pricing rules and request-fact calculation with explicit tier/TTL/context/time evidence; test thresholds, unknown rules, dates and no bucket-level threshold inference.
- [x] Run session, pricing and collector regression tests.

### Task 3: Statusline

- [x] Add CLI tests for complete, sparse, invalid and malicious stdin, zero values and read-only persisted daily costs.
- [x] Implement cli/src/statusline.ts and early index.ts dispatch; document installation command in CLI usage docs.
- [x] Run CLI tests and actual piped-input invocation in isolated data directory.

### Task 4: Shared UI

- [x] Extend session filter/sort tests; add project/sort controls and numerical per-model detail rendering to shared SessionActivityPanel.
- [x] Add shared UsageTrendExplorer + stale-safe hook using the trend API; preserve existing modes and expose independent granularity/model controls.
- [x] Replace only main Dashboard trend instances in both pages; leave tray/projection contracts intact. Add shared locale messages using explicit mechanical edits.
- [x] Run localization, UI tests, builds, Desktop typecheck; inspect browser behavior and narrow layout with isolated dev API.

### Task 5: Integration

- [x] Add changeset and data/API documentation for new fields and limits.
- [x] Freeze code for verifier and independent reviewer, resolve verified findings.
- [x] Run required full build/test checks and record exact results; deliver changed files and any material runtime limitations.

## Verification Results

- `pnpm test` completed successfully: 1,278 tests, 1,254 passed, 24 skipped, 0 failed. This includes the workspace build, Core, CLI, Dashboard, Desktop and repository script checks. Log: `.quotern-dev/usage-analysis-verification.log`.
- `pnpm --filter quotern-desktop typecheck` passed. After the browser-discovered single-point chart marker fix, Dashboard build and its 197 tests passed again, and Desktop typecheck passed again.
- Real isolated CLI/Vite verification covered hourly dates across multiple days, weekly/monthly single-point rendering, Token/cost and per-model modes, session search/project/cost sorting, expanded numerical model details and 390px layout. The page stayed within the viewport; model tables scroll inside their cards.
- Independent pricing and session/trend reviews were completed; verified findings were corrected and regression tested.
- The development API and Vite created for acceptance were stopped; their recorded process IDs no longer exist and ports 8452/5194 have no listeners. Existing unrelated session records were preserved.
- Screenshot: `.quotern-dev/usage-analysis-preview.jpg`. Electron native window/IPC interaction was not manually exercised in this run; its automated checks, build and typecheck passed. Historical data without request evidence retains its documented pricing/detail limits.
