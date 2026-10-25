# Session Query and Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cache session preparation and range summaries, page lightweight roots on the server, load complete details on demand, and complete pagination controls.

**Architecture:** A per-local-API query service shares immutable history/prepared observations and bounded range/detail caches. New list/detail routes preserve the legacy full snapshot route. Shared Dashboard components consume paged results; Desktop retains its own transport hook.

**Tech Stack:** TypeScript, Hono, React, TanStack Router, HeroUI v3, Node test runner, pnpm 11.1.2.

**Spec:** `docs/superpowers/specs/2026-10-26-session-query-pagination-design.md`

## Global Constraints

- Default 12 roots per page; optional 24/48, all state in URL.
- Preserve full matching-set export, filtering/sorting, frozen ranges, missing/unknown values, and related-detail navigation.
- Reuse HeroUI Pagination and FilterMenu; update Desktop copies and UI/API documentation.
- Never stop or modify ownership of the existing development service.

## Review Focus

- Concurrent sync and query cannot publish old materialization as a new revision.
- A descendant matching a list filter remains reachable under existing root semantics.
- A paginated summary cannot be mistaken for a fully loaded detail.
- Export uses the complete matching set, including off-page sessions.
- New controls normalize invalid/overlarge URL pages, retain focus and work on narrow screens.

### Task 1: Query service, history preparation and API contracts

**Files:** Core session-collector, session-observation, session-insights, server/local-api, new session-query/list helpers, state BucketStore, index exports; Core session-query integration tests.

**Interfaces:** List query accepts range/scope sources plus q/filterSources/project/model/group/sort/direction/page/pageSize. Response includes lightweight `sessions`, `pagination`, `facets`, original range and coverage/totals. Detail query accepts source/sessionId plus frozen range, returning a complete row. Legacy activity behavior remains.

- [x] Write and run failing integration tests for server pagination, filtering, details, export, and invalidation.
- [x] Implement bounded cached preparation/ranges and on-demand detail projection; share legacy query behavior.
- [x] Run Core focused and regression tests.

### Task 2: Shared paged UI and complete navigation

**Files:** Shared SessionsPage, SessionActivityPanel, SessionDetailDialog, session-page, session-detail-cache, new paged query hook/control/helpers/tests, independent Desktop hook adapter and i18n messages.

**Interfaces:** Consume Task 1 list/detail contracts; summary marker gates detail seeding; old-runtime fallback remains source-based. Page size is URL state and page normalization uses replace navigation.

- [x] Write and run failing tests for query serialization, page navigation/size/bounds, and summary detail loading.
- [x] Implement server query hook, complete HeroUI pagination, scoped export and on-demand detail load.
- [x] Run Dashboard tests and both renderer type checks.

### Task 3: Real acceptance and documentation

**Files:** UI/architecture/data notes, focused browser acceptance script if needed, this plan.

- [x] Run required builds and meaningful regression checks.
- [x] Compare old endpoint against new cold/hot/page/detail timings on the same collected metadata without changing it.
- [x] Inspect real pagination, navigation/filters/detail, keyboard behavior and narrow layout.
- [x] Get independent whole-change review, resolve findings and report measured limits.

## Execution record

- 2026-10-26: Main was clean at aad60a3; project rules select main in the absence of confirmed concurrent development. Existing CLI/Vite belongs to a previous session and will not be stopped. Two read-only scouts cover frontend contracts and cache invalidation gaps. User's selected approach authorizes execution; routine UI details use project conventions.
- Core and renderer implementation landed with failing-first API/query/detail-cache tests. CPU profiling identified repeated pricing-catalog scans as the largest cold-load cost; bounded model-match memoization invalidates with applied table identity.
- Independent review identified bucket-revision races, detail denominator drift, fork-evidence replay and failed-page recovery. Controlled regression tests reproduced the first three and browser acceptance reproduced the fourth; fixes preserve shared scope, ancestor evidence and explicit error/loading states.
- Follow-up review confirmed the four fixes and found that selecting the same failed query did not retry immediately. Added an explicit retry token/action and reproduced RED→GREEN in both HTTP and IPC renderer acceptance.
- Verification: full workspace build passed; `pnpm -r --if-present test` passed (1,936 passed, 25 platform skips across package runners); final Dashboard tests (285) and Desktop typecheck passed after retry wiring. Localization, demo preload and Vite Core source tests passed. Existing detail acceptance passed 30 checks; new pagination acceptance passed in browser HTTP and Desktop IPC, including direct retry and 375px layout. Native screenshots inspected.
- Root `pnpm test` stops at the unchanged npm first-publication smoke fixture attempting registry resolution of unpublished `quotern-i18n@0.1.2` (47/48 release checks pass). This release-test limitation was reported separately; package tests were then run independently.
- Read-only in-process API measurement against the active development data directory: 7 days / 542 sessions / 159 roots, first list 1,065ms and 28,133 bytes; page 4 8ms and 34,853 bytes; repeated first page 7ms. 30-day page 4: 11ms, 36,563 bytes. Exact detail 200ms first / 167ms repeated, preserving list share. Background collection continued during measurement; these are this machine's API samples, not browser paint or a stable benchmark suite.
- Existing port 5194 still proxies a pre-change API (new route returns 404). Ownership belongs to an earlier service session; it was neither stopped nor taken over. Loading the new runtime requires restarting from its original owning terminal. UI fallback remains functional in the meantime.
