# Compact Model Token Share Implementation Plan

**Goal:** Replace only model distribution with a compact ribbon-and-list card in Dashboard and Desktop, preserving existing distribution functions.

**Architecture:** Keep Agent distribution on its existing component. Both model slots use one browser-safe shared card, a pure Top5/Other projection, and a decorative proportional SVG aligned with native row buttons. Reuse the existing complete distribution list and its classification tooltips in the full-model dialog.

**Tech Stack:** Existing React 19, HeroUI 3, CSS container queries, SVG and ResizeObserver; no new dependencies.

**Spec:** User approved the compact Token Share proposal in this chat on 2026-11-13. This document records the accepted scope and implementation decisions.

## Global Constraints

- Only model distribution changes; Agent rendering and behavior remain unchanged.
- Preserve Token/cost switching, per-model visibility, visible-total denominator, restore-all, complete model access and input/cache/output/reasoning details.
- Preview Top5 plus Other; sort by the selected raw metric. Aggregate without rounding or changing stored/API values.
- Reuse Token preferences, USD formatting, four-language messages and theme chart colors.
- Wide cards connect a proportional ribbon to each row. Below 420 CSS px of card width, use compact row bars without a separate ribbon column.
- Use the managed worktree on `codex/model-token-share`, based on `0b5a0ce5`; no main integration or remote push.
- Validate both real HTTP Dashboard and Electron IPC renderer using isolated synthetic data.

## Review Focus

- Dominant/very small shares retain true thickness and accessible row targets.
- Hidden items remain recoverable; grouping never changes the denominator or loses full-list access.
- Metric switching can reorder rows without changing a model's assigned color or visibility.
- Zero totals, long names, unit changes and unknown detail fields remain readable without overflow.
- Shared component styles and translations are present in Desktop as well as Dashboard.

## Task 1: Projection and proportional geometry

- [x] Add focused tests for selected-metric ranking, Top5/Other conservation, hidden denominators, exact subcent values, zero totals and ribbon thickness ratios.
- [x] Run the new tests before implementation and confirm missing functionality fails.
- [x] Implement browser-safe projection and geometry helpers; run the tests green.

## Task 2: Shared card and integration

- [x] Add ModelTokenShareCard and scoped responsive CSS; preserve native button and HeroUI modal/tab behavior.
- [x] Export the existing complete DistributionRowList for reuse without changing its Agent usage.
- [x] Replace only the model slot in both DashboardPage files; register shared Desktop CSS sources.
- [x] Add four-language Other-count text, update UI guidelines and add a user-facing changeset.

## Task 3: Dual-renderer verification and closeout

- [x] Extend the existing dashboard smoke with model-specific metric, grouping, hide/restore, full list, classification tooltip, preference, keyboard, responsive and theme checks.
- [x] Run Dashboard unit tests, both typechecks/builds and `corepack pnpm test:dashboard-ui` with a fresh output directory.
- [x] Inspect generated HTTP/IPC screenshots and manually exercise the current shared component in a browser where available.
- [x] Obtain an independent branch review, address actionable findings, check the final diff and create a local atomic commit.

## Execution Record

- Setup: managed worktree created; frozen pnpm 11.1.2 install passed. User request provides design approval; no further design gate is needed.
- Dependency recovery: existing shared package directories were empty. pnpm 11.1.2's optimistic repeat check and directory-only GVS reuse skipped their contents. Reinstalled frozen dependencies in a task-private store with optimistic repeat disabled, keeping GVS enabled and preserving the original stores. No manifest, lockfile or repository installation-policy change.
- Verification: full workspace build; final Dashboard/Desktop rebuilds; Desktop typecheck; all 333 Dashboard tests and locale-catalog parity passed. Seven focused projection/geometry cases include subcent conservation, hidden denominators and unknown/zero cost distinctions.
- UI: `corepack pnpm test:dashboard-ui .quotern-dev/model-token-share-ui-final` passed all 14 HTTP/IPC check groups. Covered keyboard Other/full-list access, classification values, AX descriptions, focus restoration, reactive units, raw costs, 320/375/1120px layouts, 410/430px content-width breakpoints, dark mode and four languages. Screenshots inspected locally and independently; no visible clipping/overlap found. These use synthetic data, not real account billing.
- Review: independent code review found one missing accessible description; associated each row's share and amounts through aria-describedby, then verified the actual renderer accessibility tree. Agent card rendering and behavior remain on their original paths.
