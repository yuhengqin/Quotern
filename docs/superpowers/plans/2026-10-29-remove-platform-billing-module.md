# Remove Costs and Balances Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this scoped removal, with an independent final review.

**Goal:** Remove the Costs and Balances module from Dashboard and Desktop while retaining existing usage and cost statistics.

**Architecture:** Delete the dedicated page, routes, translations, OpenAI organization-cost reader, billing API, and Desktop network adapter. Remove only module-specific helpers, tests, scripts, CI steps, and documentation; retain session billing attribution, usage pricing, and quota readers.

**Tech Stack:** TypeScript, React, TanStack Router, Hono, Electron, pnpm.

**Spec:** User request in this chat: delete the module, both entries/pages and related code; preserve existing usage and cost statistics. Scope is already authorized. Implement directly in the clean main checkout under the repository worktree rules.

## Global Constraints

- Use `corepack pnpm`; do not alter personal configuration or collected usage data.
- Preserve Dashboard and Desktop usage totals, session costs, attribution, pricing and subscription quota behavior.
- Regenerate both route trees after deleting route files.
- Leave historical design/plan documents as history; reconcile current user/developer documentation and unreleased changesets.

## Review Focus

- Old GET and POST billing routes must no longer exist.
- Shared local-api code must still produce usage/cost reports and session data.
- DeepSeek and other quota readers must remain intact.
- Neither renderer may retain a billing navigation entry, API client or route.
- Builds, packaging exports, CI, translations and current docs must not reference deleted files.

### Task 1: Pin removal and preservation behavior

- [x] Extend existing Core API tests to assert removed routes return 404 while a synthetic usage/cost report remains correct; run and confirm the removal assertion fails before code changes.
- [x] Extend existing HTTP/IPC UI acceptance to assert the Dashboard toolbar has no billing entry while usage, sessions, pricing and their existing interactions remain available.

### Task 2: Remove the module and reconcile integrations

- [x] Delete dedicated Core billing sources/tests/exports and registration/dependency injection.
- [x] Delete shared page, both routes, translations, status helper and exclusive currency helper/tests; remove both entries and API clients.
- [x] Delete Desktop billing fetch/transport/tests, smoke scripts, package command and CI step; remove associated lifecycle stub and CSS source declaration.
- [x] Regenerate route trees; update current docs and changesets.

### Task 3: Verify and review

- [x] Run focused Core regression, full build, Desktop and Dashboard typechecks, affected package tests and HTTP/IPC UI acceptance.
- [x] Inspect screenshots for both toolbars and statistics; search maintained source for obsolete references; run `git diff --check`.
- [x] Obtain one independent read-only review and address substantive findings.

## Execution notes

- Initial checkout: main at 68fb25f3, clean; no other active Quotern development chat found.
- No commit, push, release, personal credential or runtime-data operation is required for this request.
- Focused Core regression: observed the expected 200-versus-404 failure before removal, then 3/3 passed after removal.
- Full build, both renderer typechecks, localization catalogs and HTTP/IPC UI acceptance passed. Wide (1120px) and narrow (375px) Dashboard screenshots were inspected; sessions, pricing, share and settings remain reachable.
- Independent review completed without actionable correctness or contract findings.
- Package checks: 1,982 passed, 25 skipped, 1 failed. The DSH truncated-frame parser test also fails with the same 1-versus-3 assertion in an archived HEAD 68fb25f3 source snapshot under Node v24.22.1. No DSH code or assertion was changed. Remaining packages and Core script tests were run separately and passed after the recursive command stopped early.
- Local evidence: `.quotern-dev/remove-platform-billing-*.log` and `.quotern-dev/session-pagination-ui-1793227893108-104272/result.json`. UI validation uses synthetic data, not live provider accounts.
- The ignored baseline snapshot (`packages/core/.quotern-dev/billing-removal-baseline-68fb25f3`) and its archive were retained because automatic policy review rejected the cleanup command without a more specific reason.
