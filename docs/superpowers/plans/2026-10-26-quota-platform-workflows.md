# Quota Platform Workflows Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task. Main implements; read-only agents investigate/review and verifier checks stable code.

**Goal:** Complete the four remaining reference-inspired quota/billing capabilities.
**Architecture:** Core declarative metadata and pure snapshot consumers; explicitly refreshed OpenAI costs behind existing local-api; shared page with independent HTTP/IPC transports.
**Tech Stack:** TypeScript/Node, pnpm 11.1.2, node:test, React/HeroUI v3.
**Spec:** ../specs/2026-10-26-quota-platform-workflows-design.md

## Constraints and review focus

No implicit credential mutation, account switching, provider request on prompt/recommend/MCP, foreign worktree/service operations, platform/local double counting, guessed model scope, or balance-as-percentage. Preserve 13 channels, native/profile/OMP intervals, demo restrictions and existing UI. Old snapshot/old runtime is unknown, never zero. Tests use fixtures, no real keys. Write only this new worktree.

## Task 1 — Provider descriptors

- [x] Add failing descriptor validation/compatibility tests in core/test/provider-descriptors.test.ts.
- [x] Add core/quota/shared/provider-descriptors.ts; derive subscription-channels and runtime metadata with exhaustive reader bindings.
- [x] Verify Core runtime/diagnostic tests and document extension contract.

## Task 2 — Recommendation and prompt

- [x] Add failing core recommendation/prompt tests, then implement pure core/quota/recommend.ts and prompt.ts.
- [x] Extend safe report projection/validation with snapshot-local canonical provider references, no private account hash.
- [x] Add CLI recommend/descriptor/prompt entry points and strict MCP recommendation; subprocess tests assert no writes/network and old behavior preservation.

## Task 3 — Platform billing

- [x] Add failing synthetic OpenAI costs tests; implement bounded billing/openai-costs.ts with explicit partial/unknown/currency semantics.
- [x] Add billing service/API and tests for no-network GET, origin/body/range validation and concurrent request coalescing; local estimate uses same instant bounds.
- [x] Add shared BillingPage, both routes/transport/navigation, four-language messages, formatting and local feedback. Register shared CSS sources and UI guidelines.

## Task 4 — Closeout

- [x] Update CLI/quota/platform docs and changeset, including precise OpenAI permissions and unsupported balance.
- [x] Run complete relevant package tests/builds, Desktop typecheck and localization checks on stable source.
- [x] Independent reviewer checks privacy, unknown scope, account/cache isolation, API limits, UI parity; fix actionable findings and rerun affected checks.
- [x] Report branch/worktree, evidence and live-account/UI limits. No implicit merge/push.

## Validation record — 2026-10-26

- Core: 749 passed, 2 skipped; script tests 16 passed. CLI: 85 passed, 3 skipped. Dashboard: 294 passed. Desktop: scripts 34 passed, compiled tests 800 passed, 20 skipped. All final relevant suites passed.
- Core/i18n/CLI/Desktop builds, Desktop typecheck, localization catalogs and diff checks passed. Existing font path, mixed import/chunk and Node module-type warnings remain.
- Independent review found three issues: Desktop transport pre-buffering before response limits, incorrect shared Tailwind source path, partial-page failures hiding their cause. All were fixed with regressions; bounded follow-up review found no further confirmed defects. Desktop lifecycle harness now explicitly stubs the new billing dependency while preserving all lifecycle assertions and forbidding network.
- Desktop generated CSS includes `min-width:38rem` and `max-h-96` (24rem). Browser synthetic-data validation covered visible partial/429 feedback, zero balance, details, keyboard period selection, help Escape/focus restoration and 390px no whole-page overflow. Browser console reported no errors. Proof: `.quotern-dev/platform-validation/billing-preview.jpg`; preview server was stopped.
- Prompt subprocess samples: 180.8 ms first call, subsequent 95.0–97.9 ms; absent data directory was not created. PowerShell users can cache the line between prompt renders.
- Logs: `.quotern-dev/platform-validation/`, `.quotern-dev/platform-validation-final/`; final Desktop repair run `desktop-after-fixture-fix.log` supersedes the earlier harness failure.
- No real OpenAI admin key, provider account, Electron-native/installer or release validation. Branch remains uncommitted, unmerged and unpushed.
