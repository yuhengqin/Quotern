# Session insights implementation plan

**Goal:** Complete the session enhancements approved in chat: coverage, model/group browsing, modal details, lineage, resume, price evidence, CSV/CLI export, performance/efficiency, and a separate local context-source audit.

**Architecture:** Preserve the current metadata-only collector and read-only reporting. Extend its numerical evidence and local metadata, aggregate once for HTTP/IPC/CLI, and share browser-safe UI between Dashboard and Desktop. Existing billing evidence and missing-data semantics remain authoritative.

**Approval:** User approved this complete scope and explicitly requested a new branch/worktree and parallel agents. Routine implementation decisions are delegated to the primary agent; no additional approval gate is introduced.

## Constraints
- Branch `codex/session-insights`; managed worktree, based on local main. Do not copy unrelated uncommitted release work.
- Use `corepack pnpm` and the frozen lockfile. No new runtime dependencies.
- Preserve notification-target lookup, overview return state, time/source scopes, pagination, sorting, billing attribution and all existing model details.
- No prompts, responses, reasoning, command output, tool arguments or credentials in persisted numerical metadata or exported reports.
- Parent linkage is typed `fork`/`subagent`/`unknown`. Missing measurements remain null; never infer subscriptions from model names.
- Own usage is the summation basis. Thread totals are derived views and are not added to own totals.
- Context audit reports discovered content estimates and unknown actual loading, never a measured fixed-context bill.

## Tasks and acceptance
- [x] Baseline: install; compile and run existing Core session and Dashboard tests.
- [x] Collection: compressed Codex discovery/reading; preserve missing ledger-only coverage; add source observations for Grok, ZCode, Droid, Copilot and DSH without inventing request counts or token breakdowns.
- [x] Evidence: typed lineage, original working directory (on-demand, never persisted), message/time metadata, performance and efficiency summaries; add tests for forks, cycles/orphans, unknown costs and duplicate events.
- [x] Shared query/report: local API and read-only CLI use shared session aggregation, insights and CSV serialization; CSV protects formula cells and retains provenance/nulls. CLI `quotern sessions` branches before runtime initialization.
- [x] Context audit: bounded read-only discovery of instruction/skill files and MCP declarations; metadata-only response; no assumed tool schema costs or actual-loaded tokens. Test private-content exclusion and scanning limits.
- [x] Browser: model facet, date/project grouping, folded lineage with child-model filter, modal details, resume/directory copy, price explanations, exports and context audit entry. Preserve compact list and 12-root pagination.
- [x] Cross-client integration: Dashboard and Desktop shared modules, aliases and CSS scanning; four locales; update UI/data/architecture notes and changeset.
- [x] Verification: relevant unit/integration tests, Core/CLI builds, both renderer typechecks, actual isolated browser verification, independent code review and scoped fixes.

## Review focus
1. Source/session identity collisions, duplicate snapshots and inherited fork prefixes must not inflate totals.
2. Unknown or partial prices stay unknown/partial in thread totals, detail and export.
3. Relation cycles/conflicts/orphans cannot hide sessions or recurse indefinitely.
4. Notification focus and account-attribution scoping remain intact when filters/groups change.
5. Request durations/TTFT/efficiency are sampled evidence, not inferred from whole-session wall time.
6. Local path and config content stay out of cloud reports and context audit output.

## Progress
Implemented in `codex/session-insights` at `C:/Users/Admin/.codex/worktrees/session-insights/Quotern`; unrelated main release changes remain untouched. Dependencies use a checkout-local pnpm store because pre-existing global-store targets were empty; no dependency or lockfile changes were required.

Validated: Core 653 tests (652 pass, 1 Windows skip), Core script tests 16 pass; CLI 74 tests (71 pass, 3 Linux-only skips); Dashboard 243 pass; Vite source contract 4 pass; localization catalogs 1 pass. Core, Dashboard, CLI and Desktop builds and Desktop typecheck passed. Independent reviews led to regression fixes for cumulative snapshots, inherited DSH usage, pricing gaps, lineage paths, live modal state, timezone grouping and bounded directory reads.

Browser checked actual isolated data: model filtering/URL state, project grouping, folded children with independent model filter, CSV download, live detail modal, resume copy feedback, on-demand directory, pricing expansion, context audit and Escape/focus return. Screenshot: `.quotern-dev/session-details.png`. Native Electron interactions and release packaging were not exercised.
