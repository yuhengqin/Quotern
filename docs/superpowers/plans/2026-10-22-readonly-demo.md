# Read-only Demo Implementation Plan

> **For agentic workers:** Primary agent implements inline with superpowers:executing-plans. Read-only agents provide bounded investigation and final independent review; no semantic implementation delegation. Steps use checkbox tracking.

**Goal:** Export anonymous current usage and serve a completely separate, immutable interactive demo without touching normal clients or data.

**Architecture:** One versioned JSON bundle contains explicit public projections of queue/history/achievements/pricing. A separate CLI branch loads it in memory and supplies demo dependencies to the shared read API, while static HTML injects browser-only capabilities before React mounts.

**Tech Stack:** Existing Node/TypeScript, Hono, React and HeroUI; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-readonly-demo-design.md`

## Global Constraints

- Use Corepack pnpm 11.1.2, Node 22.13+ for development; no normal service startup or source-data writes.
- Worktree `readonly-demo` owns all modifications and temporary outputs. Other worktrees/services remain untouched.
- No automatic commit, push or cloud deployment. Browser demo state is opt-in; Desktop defaults stay normal.

## Review Focus

- Nested unknown values and labels must not escape anonymization; numerics, null/unknown and fork identity semantics remain intact.
- Output paths traversing symlinks/junctions must not overwrite or be placed inside source data.
- GET achievements/quota/background routes must not indirectly mutate state or inspect host Agent data.
- Initial render, focus and range/share actions must not emit writes or migrate normal browser state.
- Reference clock must cover preset, rolling, heatmap and session views without changing normal/Desktop clocks.

### Task 1: Snapshot export and validation

**Files:** new `packages/core/src/demo/{types,schema,projection,snapshot}.ts`, `packages/core/test/demo-snapshot.test.ts`; modify `achievements/store.ts`, pricing snapshot helpers and `index.ts`.

**Interfaces:** `exportDemoSnapshot(sourceDir, outputFile)` writes an exclusive versioned JSON; `loadDemoSnapshot(file)` returns `DemoSnapshot`; `AchievementStore.readOnly()` creates final snapshot without a transaction or write.

- [x] Write/run failing privacy, equality, read-only source, overlap/collision and invalid-format tests.
- [x] Implement explicit projection, random equivalence mappings, read-only achievement projection, stable-read retries and bounded validation.
- [x] Verify tests plus existing achievement/session/report contracts.

### Task 2: Separate demo service and CLI

**Files:** new `packages/cli/src/demo.ts`, CLI tests and Core demo API tests; modify CLI early dispatch/help, Core API deps/routes and static HTML injection.

**Interfaces:** `demo export --out [--data-dir]`; `demo start --file [--host] [--port]`, default 127.0.0.1:8253. `LocalApiDeps.demo` supplies snapshot/history/reference time. `createHttpServer` accepts optional demo bootstrap metadata.

- [x] Write/run failing CLI parsing/startup isolation/API mutation and clock tests.
- [x] Implement early branch before normal runtime, pure memory serving, fail-closed method guard and safe bootstrap JSON.
- [x] Verify read endpoints, all mutation methods, source and bundle immutability, missing file/port collision and normal API compatibility.

### Task 3: Browser capability, date and action boundaries

**Files:** new Dashboard demo-runtime helper/tests; modify only necessary Dashboard initialization/date/storage/actions plus shared component optional parameters and corresponding Desktop no-op adapter where needed.

**Interfaces:** `isDemoMode()`, `dashboardNow()` and `demoStorageKey(key)` read injected metadata; no Core global clock override. Shared components default to normal behavior.

- [x] Write/run failing frozen-clock/storage/action-policy tests.
- [x] Add banner, freeze relevant date defaults, suppress automatic/server mutations and omit live quota; preserve browsing and local share export.
- [x] Verify Dashboard tests/build and Desktop typecheck; document UI component boundaries.

### Task 4: Local delivery and acceptance

**Files:** `CLI.md`, architecture/runtime/UI docs and this plan's validation record; local untracked demo JSON stays under `.quotern-dev/`.

- [x] Run full repository tests and appropriate builds, inspect diff.
- [x] Export actual current persisted data to this worktree's private artifact directory and exercise independent local demo with browser/network checks.
- [x] Independent read-only review, fix material findings with regression tests, report usable commands and exact limits.

## Validation record

- Baseline: initial install produced missing shared-store TypeScript targets despite “Already up to date”; confirming links and repairing only this worktree's pnpm state/install, without changing dependency manifests or other worktrees.
- Final build: `corepack pnpm build` passed for Core, i18n, Dashboard, CLI and Desktop. Desktop `typecheck` and `git diff --check` passed. Workspace tests: 1,818 passed, 24 skipped; all remaining root pipeline checks also passed (50 passed, 11 platform skips).
- Full `corepack pnpm test` was run twice and stopped in the unchanged release smoke test: 44 passed, 1 failed with `ERROR packages field missing or empty`. The original three release scripts extracted from baseline `811f259` reproduce the same failure under nested pnpm scripts; direct script invocation passes. This existing release-test environment issue is outside the demo change. Logs and isolated baseline fixture remain in `.quotern-dev/demo-validation/`.
- Regression cycles verified privacy/number/provenance preservation, exclusive output/source isolation, malformed input, read-only API/CLI startup, clock/storage boundaries, `..` child path isolation and overlay alias/fuzzy price precedence. Independent backend and frontend reviews found the latter two issues plus exchange-rate storage and recent-release clock omissions; all four were reproduced and corrected with tests.
- Real persisted data export: `.quotern-dev/demo/demo.json`, 1,228 buckets and 21,221 logical messages, exported/reference time `2026-10-22T14:56:56.469Z`. Local-only demo runs at `http://127.0.0.1:8623`, independently of normal runtime ownership.
- Browser acceptance: banner, 30-day range, session list/expand, achievement browsing/disabled editing and share-card download exercised; 88 observed requests contained no non-GET/HEAD methods, with no console errors. Final rebuild reload confirmed current banner/achievements, 394-model catalog and CNY conversion. The final browser CDP recheck was unavailable; latest clock/storage regressions and API checks passed. Earlier browser preferences contained only demo-prefixed keys.
- Final CLI smoke: a second start on occupied 8623 fails safely, does not create isolated normal-data or identity directories and leaves the existing demo healthy. POST/PUT/PATCH/DELETE/OPTIONS return 403; HEAD succeeds; bootstrap precedes module execution; snapshot SHA-256 remains unchanged.
- No cloud deployment, Electron live launch, commit, push or merge was performed. Normal source data was read only, and normal clients/services were not started, stopped or reconfigured by this work.
