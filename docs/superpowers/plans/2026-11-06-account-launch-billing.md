# Account Launch and Billing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. The primary agent implements; bounded investigators and a final read-only reviewer support verification.

**Goal:** Launch monitored accounts, select and automatically rotate the default Claude launch account, and view Claude Extra Usage / Console actual costs.

**Architecture:** Core owns account selection, terminal execution, billing requests and private credentials. Privileged loopback APIs serve shared Dashboard components through HTTP or Desktop IPC. The quota owner evaluates automatic selection using existing recommendations.

**Tech Stack:** TypeScript, Node, Hono, React, HeroUI, pnpm 11.1.2.

**Spec:** `docs/superpowers/specs/2026-11-06-account-launch-billing-design.md`.

## Global Constraints

- Node development >=22.13; use `corepack pnpm`; no new dependencies.
- Work in `codex/account-launch-billing`; preserve other worktrees and running services.
- No credential copying, shell-profile changes, live account mutations, or quota-history export.
- Shared components must retain Desktop IPC, four locales, formatUsd and accessible feedback.

## Review Focus

- Shell metacharacters and user-installed CLI paths must not cause injection or incorrect discovery.
- Removed/retargeted profiles, a changed owner, and simultaneous selection changes must not silently switch identity.
- Automatic rotation must not choose stale, duplicate, unknown or exhausted accounts.
- Partial/malformed upstream costs must never appear as a complete zero-dollar bill.
- Tokens/cookies must not reach API responses, logs, argv, backup files or plaintext Windows storage.

### Task 1: Account launch and default selection

Files: `packages/core/src/quota/account-launch.ts`, `quota/shared/account-launch.ts`, `session-actions.ts`, `server/account-launch-api.ts`, `server/local-api.ts`, `server/state.ts`, `packages/cli/src/launch-command.ts`, `index.ts`; tests under `packages/core/test/account-launch.test.ts` and existing session-action tests.

- [x] Add failing tests for literal environment binding, pinned profile selection, revision conflicts, removed/changed profiles and source directory routing.
- [x] Implement structured profile environments and a reusable terminal launcher; add revision-checked selection and `quotern launch` CLI.
- [x] Expose local-only GET/POST account actions with per-runtime token; register HTTP/IPC and demo exclusion.
- [x] Run focused Core and CLI tests (expect pass); include the account feature in the final cross-feature commit.

### Task 2: Automatic default Claude rotation

Files: `packages/core/src/quota/account-auto-switch.ts`, `quota/runtime.ts`, account settings/types and tests.

- [x] Add failing synthetic tests for exhausted current account → available alternative, stale/unknown/duplicate exclusion, owner loss, concurrent manual selection and repeated observations.
- [x] Add owner-aware runtime evaluation, atomic selection updates and last-switch evidence, disabled in isolated development.
- [x] Run focused tests; ensure paused/disposed runtime cannot commit pending rotation.

### Task 3: Read-only billing connections

Files: `packages/core/src/quota/billing.ts`, `billing-store.ts`, `shared/billing.ts`, `server/billing-api.ts`, `server/local-api.ts`; tests `packages/core/test/billing.test.ts` and `billing-api.test.ts`.

- [x] Add failing tests for cents conversion, zero/unknown distinction, independent partial results, month bounds, credentials omitted from views and denied cross-origin/remote writes.
- [x] Implement fixed-origin bounded reads, Extra Usage and Console projections, connection validation/discovery, private persistence and cached stale results.
- [x] Run synthetic request/store/API tests and Windows DPAPI round trip without real credentials.

### Task 4: Shared interfaces and acceptance

Files: shared `AccountLaunchControls.tsx`, `BillingPanel.tsx`, `QuotaProfilesManager.tsx`, two subscription grids/settings, i18n catalog, Desktop CSS sources, docs and changeset.

- [x] Add account launch/default/auto-switch controls and an on-demand billing dialog with per-connection setup, organization selection, retry, replacement/removal and readable breakdowns.
- [x] Verify both transports, failed saves retaining drafts, keyboard/focus, narrow layouts and localized amounts using controlled runtime fixtures.
- [x] Run full build, Desktop typecheck, appropriate suites and full repository tests. Inspect output and report any baseline limitation separately.
- [x] Obtain independent whole-change review; fix actionable findings with regression coverage. Update docs and deliver verified branch without merging into another active task.

## Acceptance record — 2026-11-06

- `corepack pnpm test`: passed, including the full build and all package suites (2,218 passed, 36 platform/environment skips, 0 failed).
- `corepack pnpm --filter quotern-desktop typecheck`: passed.
- `node apps/desktop/scripts/run-account-billing-smoke.mjs`: passed against built Dashboard and Desktop renderers with synthetic data; covered launch/default/keyboard controls, retained failed-connection drafts, organization selection, zero/unknown/sub-cent amounts, stale partial results, model/key breakdowns, 375px/1280px layouts, independent disconnect and focus restoration.
- Independent reviews covered account/runtime/CLI and billing/API/UI. Regression tests cover canonical duplicate identities, initial identity binding, Windows quoted/empty/JSON arguments, HTTP Host validation, cache serialization bounds, and normalized-path/chunked request limits. The final full suite ran after the normalized-path fix.
- Real upstream account reads and native macOS/Linux terminal execution remain unverified. No real account credentials or quota-consuming calls were used in acceptance.
