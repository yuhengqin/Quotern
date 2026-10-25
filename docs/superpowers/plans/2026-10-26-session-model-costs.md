# Session model costs implementation plan

> Execute inline with the executing-plans workflow. User authorization: implement the selected expandable-model design and omit technical evidence from the interface.

**Goal:** Combine model usage and prices in expandable rows with trustworthy cost details.

**Architecture:** Core supplies per-category quantities, applicable rates and costs from the same calculation used for request pricing. The shared Dashboard detail model aggregates those items and provides an explicit fallback for older runtimes. HeroUI hosts the summary table; each model opens an adjacent full-width detail row.

**Tech Stack:** TypeScript, React 19, HeroUI 3.2.4, Node test runner, Electron synthetic UI acceptance.

**Spec:** ../specs/2026-10-26-session-model-costs-design.md

## Global constraints

- Retain all main-table information, total/allocation semantics and reference-price navigation.
- Hide technical matching evidence from the interface; retain material unknown/partial/recorded states.
- Reuse common quantity, cost and rate formatters; do not change monetary totals or source precision.
- Main was clean at 3288897715fd4bd01ac12e5f70af4ceb994db9a8, with no confirmed concurrent development; work directly on main under repository policy.
- Run scripts with corepack pnpm; UI acceptance uses isolated synthetic data, not production runtime writes.

## Review focus

- Mixed service tiers, long-context pricing and TTL rates must remain separate when their unit prices differ.
- Source-reported totals and legacy estimates must not acquire invented category costs.
- Missing member details and unpriced categories must not turn into zero or appear complete.
- Reasoning is included in output; aggregation cannot count it twice or mutate cached snapshots.
- Expanded rows must remain keyboard accessible and confined to the existing table scroll region at narrow widths.

## Task 1: Pricing detail contract

Files: Core request-pricing/index/session-observation and their existing tests; Dashboard session-detail and tests.

- [x] Add failing tests for effective per-request rates/TTL, recorded cost boundaries and cross-member aggregation/fallback.
- [x] Add optional category/rate/quantity/cost items using shared pricing logic, without changing authoritative totals.
- [x] Aggregate items by category and actual rate; retain unknown costs when old records lack breakdown.
- [x] Run targeted Core and Dashboard tests.

## Task 2: Expandable model UI

Files: shared SessionUsageBreakdown, usage-messages, session-detail-smoke, docs/ui-guidelines and a changeset.

- [x] Update synthetic UI checks for collapsed model controls, adjacent detail tables, multiple rates, missing costs and absent technical fields.
- [x] Replace global price cards with accessible per-model expansion; preserve the summary columns and reference-price link.
- [x] Add four-language copy and update the component contract and release note.
- [x] Build both renderers and run Desktop typecheck, Dashboard tests, locale checks and session-detail UI acceptance.

## Task 3: Final verification

- [x] Inspect wide/narrow, light/dark screenshots and fix any layout issues.
- [x] Obtain one independent review of the final change, resolve actionable issues, and rerun affected checks.
- [x] Run git diff --check and report the verified scope and remaining limits.

## Execution notes

- The existing session formatter still used four decimals and the registered USD formatter kept trailing zeroes. Updated the shared USD entry in both renderers and delegated session formatting to it so the new detail amounts follow the existing two-decimal product contract. Unit rates continue using the separate four-significant-digit formatter.
- Added optional `SessionModelUsage.costBreakdown` items. Only request-fact estimates with recorded token parts receive confirmable category costs; source-reported amounts and legacy data retain reference rates and unknown category charges. Authoritative model/session totals are unchanged.
- Core and display-contract review, followed by a separate UI-contract review, found no blocking issues in their specified static scopes.
- `corepack pnpm build`, Desktop typecheck, Dashboard's 286 tests, the Core suite (718 passed / 2 skipped, plus 16 script tests), and a final 83-test pricing/session regression run passed. Locale-catalog validation also passed.
- `corepack pnpm test:session-detail-ui` passed all 33 browser/Desktop acceptance checks, including keyboard expansion, unknown legacy item costs, multiple rates, cache lifetimes, partial item costs, saved Token unit preferences, narrow layouts, reference windows and existing session actions. Screenshots use synthetic records under `.quotern-dev/session-detail-ui-1792953784650-7064/`.
- CLI tests passed (78 passed / 3 skipped). Desktop tests passed (34 script tests, plus 799 passed / 20 skipped in the compiled suite). The final CLI build copied the updated Dashboard assets into the bundled panel.
- The first broad Dashboard test was incorrectly run during Core's build cleanup; its missing-module failures disappeared after building first. One UI run timed out while opening the existing independent child-session window; its failure screenshot showed loading, and an unchanged rerun passed. Failure diagnostics remain isolated under `.quotern-dev/`; no production service was restarted.
- The user authorized a local Git commit after verification. No push, release or production-data mutation was performed.
