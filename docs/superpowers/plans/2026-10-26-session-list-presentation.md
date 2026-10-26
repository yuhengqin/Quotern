# Session List Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the six session-list improvements approved in this conversation.

**Architecture:** Keep the shared Dashboard/ Desktop session list and existing query contracts. Put disclosure controls beside the row's detail trigger, group toolbar controls by purpose, and change display labels without changing record identity.

**Tech Stack:** React 19, HeroUI 3, Tailwind 4 container queries, TypeScript; existing Electron synthetic UI smoke.

**Spec:** User-approved six-point review in this conversation: inline related-session disclosure; filter/view/action groups; responsive sorting with duration retained; clearer metrics; trustworthy names and conservative fallbacks; root versus related-inclusive counts.

## Global Constraints

- Work directly in the initially clean main checkout; no other active development was identified.
- Preserve all filters, grouping, pagination, CSV precision, audit, detail opening, nested relationships, and old-runtime fallback.
- Reuse FilterMenu and existing token/cost formatters; preserve saved units and zero/unknown/partial semantics.
- No parser changes, inferred titles, new dependencies, or changes to original project filter values.
- Desktop re-exports the shared files; keep its Tailwind source registration valid.

## Review Focus

- Disclosure is an independent keyboard-operable button, never nested in the detail button; keep descendant model filtering and focus behavior.
- Width changes retain units and sorting access; duration must remain available in both layouts.
- Root counts come from complete filtered pagination metadata, never the current page's row count.
- Long paths, URLs, literal percent names and unnamed sessions preserve full original identity.
- Synthetic browser and IPC checks must cover filters, sort direction, disclosure, pagination, and narrow-screen overflow.

### Task 1: Label behavior

- [x] Add behavioral tests for explicit path/URL shortening, literal percent/slug preservation, long-label abbreviation, trusted titles and fallback identity.
- [x] Run the tests before implementation, then implement small display-only helpers and rerun.

### Task 2: Shared list presentation

- [x] Update SessionActivityPanel toolbar, responsive sort controls, inline disclosure, metrics and counts; add the needed four-language messages.
- [x] Preserve original filters, query values, detail entry points, association model filters and descendants.
- [x] Update the current UI guidelines and add a changeset describing the user-visible change.

### Task 3: Verification

- [x] Extend existing pagination smoke with focused assertions for the six changes and screenshots of both viewport layouts.
- [x] Run Dashboard tests/build, Desktop typecheck/build, localization checks, pagination smoke and relevant detail smoke.
- [x] Independently review the final diff and inspect generated screenshots, repair material findings, and report precise validation limits.

## Results

- `corepack pnpm build`: passed for Core, i18n, Dashboard, CLI and Desktop.
- `corepack pnpm --filter quotern-dashboard test`: 290 passed; includes four new display-label cases. Reran after build finished to avoid Core dist cleanup racing the tests.
- `corepack pnpm --filter quotern-desktop typecheck`: passed.
- `corepack pnpm test:localization-catalogs`: passed.
- `corepack pnpm test:session-pagination-ui`: HTTP and IPC passed paging, keyboard, history, search, counts, related model-filter retention, both sort directions and 375px overflow checks.
- `corepack pnpm test:session-detail-ui`: passed existing browser/IPC detail, keyboard, unit-preference, narrow-screen and old-runtime scenarios.
- Read-only code review found a smoke selector issue, corrected by restricting it to the detail trigger. Screenshot inspection led to preserving the project suffix, anchoring hidden accessible text to prevent overflow, and reclaiming narrow-row spacing.
- Validation used synthetic records and isolated temporary profiles; no live personal collection or release was changed. Full root `pnpm test` and packaged installer acceptance were outside this UI task.
