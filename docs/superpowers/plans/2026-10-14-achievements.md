# Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver all fourteen achievement/footprint series with persistent shared state, an accessible collection page, celebrations and PNG sharing.

**Architecture:** Pure Core evaluation consumes complete deduplicated local history. A locked disk store preserves unlocks and claims notifications, exposed by the existing local Hono HTTP/IPC contract. Dashboard owns shared UI; Desktop reuses shared components with its own transport.

**Tech Stack:** TypeScript, Node, Hono, proper-lockfile, React 19, HeroUI 3.2.4, TanStack Router, existing html-to-image.

**Spec:** ../specs/2026-10-14-achievements-design.md

## Global Constraints
- All fourteen series and exact thresholds from the spec; no deferred series.
- Local-only data; no production fixtures, analytics, new dependencies, merges or pushes.
- Independent worktree codex/achievements from ad5b91c. Preserve the original checkout.
- Asia/Shanghai calendar, full observed history independent of dashboard filters.
- Preserve earned high watermarks and distinguish estimated costs/session span from actual payments/human focus.

## Review Focus
- Duplicate/replayed history, zero-value corrections and missing sources must not invent progress.
- Leap-month boundaries and midnight without fresh usage must settle period awards correctly.
- Multiple processes claiming notices or editing showcase must not lose unlocks or preferences.
- Same project basename in distinct paths must not merge; source records without identity remain explicitly uncovered.
- Narrow screens, keyboard dialogs, disabled notifications and export errors must keep navigation and earned state usable.

### Task 1: History facts and stable project evidence
**Files:** core session-metrics.ts, session-sources.ts, session-collector.ts; new achievements/facts.ts and types.ts; relevant core tests.
**Interfaces:** produce AchievementFacts via readAchievementFacts(dataDir, now?) and readSessionHistory(dataDir, usageSources); extend optional project identity metadata.
- [ ] Add/run failing behavioral tests for deduped all-history facts, project separation and legacy cache backfill.
- [ ] Implement facts from queue last versions and materialized session messages, safe project hashes and automatic session schema enrichment.
- [ ] Run targeted session and new history tests; preserve existing session semantics.

### Task 2: Complete rules and calendar evaluation
**Files:** core achievements/catalog.ts, evaluate.ts; core test/achievements.test.ts.
**Interfaces:** evaluateAchievements(facts) produces descriptors/progress, records, annual summaries and coverage.
- [ ] Add/run failing threshold, streak, leap February, closed-period, scoped Agent/project and yearly evaluation tests.
- [ ] Implement all fourteen series and stable IDs; snapshot unlock evidence without claiming human focus or actual spend.
- [ ] Run new rule tests with literal expected outputs.

### Task 3: Shared disk store and HTTP/IPC contract
**Files:** core achievements/store.ts; server/achievements-api.ts; local-api.ts; index.ts; core API/store tests.
**Interfaces:** AchievementSnapshot plus POST operations claim-notice, mark-seen and preferences; max3 unlocked showcase IDs.
- [ ] Add/run failing real-disk persistence, concurrent claims/updates, corruption and malformed/forbidden-origin API tests.
- [ ] Implement lock/atomic writes, permanent unlock merge and source-data reevaluation on queries; register shared API.
- [ ] Run targeted core tests and build core.

### Task 4: Collection, entry points and celebrations
**Files:** dashboard achievements/* UI/context; routes/achievements.tsx; AppShell/FilterChromeActions/DashboardOverviewCard in both clients; mirrored API adapters.
**Interfaces:** AchievementProvider accepts fetch/update adapters; useAchievements supplies collection/actions to both clients; reusable shared page.
- [ ] Add/run failing view-model tests for grouping highest tiers, closest targets, unread state and privacy defaults.
- [ ] Implement responsive shelf, recently earned, category filters, expandable tiers, progress, records/year selection, errors/empty states.
- [ ] Add top action and heatmap context entry, background refresh/claim and opt-in detail celebrations.
- [ ] Generate route trees with Vite and build/typecheck both clients.

### Task 5: Badge artwork and share export
**Files:** shared BadgeArtwork, AchievementShareModal, share helpers/tests.
**Interfaces:** preview supports single, shelf or annual; uses existing PNG rendering/clipboard functions.
- [ ] Add/run failing payload tests ensuring hidden cost/project fields cannot leak into export.
- [ ] Implement native SVG badge artwork, share preview, optional privacy switches and copy/download with errors.
- [ ] Verify exported PNG pixels and dimensions in a browser using isolated fixture data, never production data.

### Task 6: Integration, documentation and final verification
**Files:** docs/data-notes.md, architecture notes as needed, changeset, spec/plan progress.
- [ ] Document actual series, sources, storage, calendar, privacy and data caveats.
- [ ] Run full core/dashboard/desktop/CLI tests via corepack pnpm test and Desktop typecheck.
- [ ] Independently review stable branch changes; fix actionable findings with focused regression tests.
- [ ] Verify desktop shared route/typecheck and browser desktop/narrow/dark interactions; commit tested changes and report branch/worktree.
