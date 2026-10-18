# Quotern Product Localization Implementation Plan

> **For agentic workers:** Use independent file ownership and integrate in `main`; verify each boundary before claiming completion.

**Goal:** Ship offline `zh-CN`, `en`, `ja`, and `ko` product UI and text output with system/manual language choice.

**Architecture:** A shared `quotern-i18n` package owns locale normalization, translation catalogs, and React integration. Browser and Desktop select locale at their roots; Desktop main broadcasts its persisted choice to native surfaces. Core emits semantic codes or fields where text currently controls behavior; CLI localizes its human-readable output.

**Tech Stack:** TypeScript, React 19, i18next, react-i18next, Electron, React Aria, Intl.

**Spec:** `docs/superpowers/specs/2026-10-17-product-localization-design.md`

## Global Constraints

- Work directly on the clean `main` workspace as the user requested. Do not stop or take over services with unverified ownership.
- Preserve API and JSON/CSV machine contracts, `Asia/Shanghai` statistics boundaries, and the selected currency.
- Dashboard and Desktop renderer have both shared reexports and independent copies; check both before editing.
- Never use localized display strings as business discriminants. Ensure offline translations and accessible labels.

## Review Focus

- A manual selection survives restart and system mode resolves known/unknown system languages.
- Open Desktop windows, tray, pet, and notifications follow one preference.
- A message with count or amount translates as a full sentence in all four locales.
- API/CSV/JSON contract values do not change when locale changes.
- Changing language never shifts the statistics day or converts USD automatically.

## Tasks

### Task 1: Shared locale foundation

Create `packages/i18n` with pure locale utilities, bundled catalogs, `t`/`getFixedT` access, and React provider/hooks. Add workspace dependencies and root integration. Test locale normalization, system fallback, and interpolation before implementation.

### Task 2: Browser locale preference and UI

Persist Web preference and add a language selector in settings. Localize navigation, dashboard, sessions, filters, charts, sharing, pricing, ranking, achievements, errors, labels, and exported visuals. Preserve existing data semantics. Test switching and translation coverage.

### Task 3: Desktop locale preference and surfaces

Persist Desktop preference in main, expose IPC through preload, broadcast to windows, tray, pet, and native UI. Localize Desktop-only renderer copy, dialogs, notifications, and update messages. Test preference and IPC behavior.

### Task 4: Core and CLI presentation boundary

Replace text-as-control-flow with semantic fields/codes, localize user-visible Core-derived notices at presentation boundaries, and localize CLI help/status/errors/text reports while preserving machine output. Test behavior and contract stability.

### Task 5: Integration and validation

Run catalog completeness and placeholder checks, typechecks, builds, and relevant tests. Inspect English, Japanese, and Korean in the browser and Desktop where feasible. Review changed files, reconcile shared component copies, and produce a changeset for the user-facing feature.
