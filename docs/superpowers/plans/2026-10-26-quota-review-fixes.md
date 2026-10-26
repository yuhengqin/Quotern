# Quota review fixes implementation plan

> Execute inline using systematic debugging, test-driven development and final independent review. User authorized all five reviewed fixes; reuse the existing worktree and retain its uncommitted feature work.

**Goal:** Resolve the five reproduced acceptance failures without changing credentials, account selection or monetary precision.
**Architecture:** Keep snapshot failures bounded, apply conservative recommendation evidence rules, accept Gemini's existing settings format, preserve safe billing labels and make shared billing metrics fit their cards.
**Tech Stack:** TypeScript, Node test runner, React/HeroUI, Electron acceptance driver.
**Spec:** ../specs/2026-10-26-quota-platform-workflows-design.md and the five findings in this chat.

## Constraints and review focus

- Keep default CLI/MCP queries read-only. Preserve snapshot coalescing and recovery after a failed batch.
- Claude recommendations require both known shared session/week windows; partial observations remain available for display. Codex may have one account window and feature periods differ from account periods.
- Gemini comments must not corrupt strings or make malformed settings valid. Do not refresh or save credentials.
- Preserve bounded normal line items, including input/output token names; continue stripping credential-shaped labels.
- Keep currency formatting and complete numeric strings. Check actual rendered text bounds, not only document scroll width.

## Tasks

- [x] Add failing regressions for snapshot directory failure/recovery, missing Claude shared windows, commented Gemini settings and official billing line items; run the targeted compiled tests.
- [x] Fix the four Core paths and verify those regressions plus the complete Core suite.
- [x] Add persistent HTTP/IPC billing acceptance with long amounts at browser 375/390/800/1120 and Desktop 800/1120; observe failure, fix the shared page and recheck both outputs.
- [x] Update the existing CLI/quota/UI documentation and changeset where behavior is clarified.
- [x] Build all packages, typecheck Desktop, run the four package suites/localization and root checks appropriate to the change; run subprocess and UI acceptance on stable builds.
- [x] Get a fresh bounded review of the fixes, resolve material findings, record verification and leave the work uncommitted/unmerged unless requested.

## Verification record

- The four original Core regressions failed before their fixes and passed afterward. Billing acceptance failed at browser 800px (312px text in a 179px metric) before the shared layout/typography change, then passed for both renderers.
- Independent review confirmed the snapshot, recommendation, Gemini and UI fixes and found a prefixed-credential-label gap. A new regression reproduced all five escaped labels; the final filter hides them while retaining normal input/output token line items.
- Before that final narrow label adjustment, `corepack pnpm test` completed with 2,097 passes, 36 skips and no failures (2,133 tests), including the full build and five package suites. Logs: `.quotern-dev/review-fixes-validation/root-test.log`.
- After the final label adjustment: the complete Core suite passed (756 compiled tests and 16 script tests, 2 skipped); full workspace build, Desktop typecheck and `test:billing-ui` passed. Final logs: `.quotern-dev/review-fixes-validation/final-core.log` and `final-build.log`.
- Final billing acceptance: 8 groups covering real HTTP/IPC with synthetic provider responses, browser 375/390/800/1120px, Desktop 800/1120px, keyboard, currencies, official line items, failures and zero/unknown values. Results and six screenshots: `.quotern-dev/review-fixes-validation/final-billing-ui/`; the 800px Desktop screenshot was visually inspected.
- Actual CLI/MCP probes returned unknown for missing Claude shared evidence; snapshot collision rejected after one mkdir attempt; plain and commented Gemini settings both completed the two synthetic queries. Probe records: `.quotern-dev/review-acceptance/cli-1793011344883/` and `edges-1793011344880/`.
- No live account/credential requests or installer/release validation. Existing build warnings about font paths/chunks remain. The branch remains uncommitted, unmerged and unpushed.
