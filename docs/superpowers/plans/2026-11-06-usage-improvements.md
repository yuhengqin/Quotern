# Usage improvements implementation plan

> **For agentic workers:** Use `superpowers:executing-plans`; the primary agent implements semantic changes. Delegated investigation and review are read-only and follow AGENTS.md.

**Goal:** Add the requested usage diagnostics, Agent integrations and desktop conveniences, excluding offline report export.

**Architecture:** Extend the existing Core collection, session and quota contracts. Reuse shared Dashboard components in Desktop, existing HTTP/IPC transports, formatting, localization and isolated development launchers. Agent behavior changes and model requests are individually opt-in; existing collection hooks remain independent.

**Tech Stack:** TypeScript, Node.js, React 19, HeroUI 3, Electron, pnpm 11.1.2.

**Spec:** The requirements and acceptance criteria below record the approved comparison scope. Work on `codex/usage-improvements`, based on `866ea41e`, in the dedicated `usage-improvements` worktree.

## Requirements and constraints

- Preserve existing statistics, session actions, quota channels, display preferences and four languages.
- Statusline: use host context/cache observations, warn near capacity and on measured rapid growth; missing data stays unknown and suspected cache causes stay suspected.
- Diagnostics: detect repeated reads, generated-directory scans, large/repeated tool results and high-consumption sessions. Show bounded evidence and concrete advice without saving raw prompts, tool output or secrets.
- Insights: explain significant growth, peaks and project/model contributions for the selected date/source range. Link to the corresponding sessions; avoid normal-state narration.
- Agent workflow: separately enable quota hints, Token Saver and beginner explanations. Hooks remain nonblocking, bounded and deduplicated. Installation/removal preserves unrelated settings and rejects malformed configuration.
- Handoff: prepare an inspectable continuation summary from selected session evidence and current Git metadata; the user controls copying or starting a new session.
- Claude pane: optional plugin displays host quota/context and observed session states. Do not claim historical activity proves an Agent is currently running.
- Cross-tool attribution: explicit session IDs are recorded evidence; time/project matches are labeled inferred and ambiguous candidates remain unlinked. No quota share is presented as a bill.
- Muse: collect known completed-model records, handle replay and partial tails, and expose session use. `muse usage --json` is a read-only quota probe; missing CLI/cache does not trigger a paid request.
- Quota: add a distinct depleted event and deduplicate it per account/window. Add opt-in window startup with fixed arguments, bounded execution, owner checks and durable attempt markers; ambiguous/missing window state does not trigger a request.
- Desktop: pin/move a quota panel, order favorite accounts and use compact layout; persistent overview can be enabled and disabled without changing the existing tray behavior.
- Appearance: add 16 named accent palettes alongside the existing system/light/dark preference, with accessible foregrounds in both modes.
- Implement from contracts and behavior; do not copy AGPL reference source into this MIT project.

## Review focus

1. Missing/zero/stale metrics must not become confident diagnosis or trigger model requests.
2. Replayed JSONL, partial lines, file rewrites and late project metadata must not double-count Muse use.
3. Concurrent config writes and user-owned hooks must survive install/remove; no shell interpolation of untrusted content.
4. Filter changes and source scope must update insights and preserve navigation targets.
5. Desktop windows, observers and runtime restarts must not duplicate quota actions or alter other sessions' services.

## Task 1 — Host statusline diagnostics

Files: `packages/cli/src/statusline.ts`, new `statusline-diagnostics.ts`, `packages/cli/test/statusline.test.js`.

- [x] Add cases for host cache ratio/cause, unknown metrics, threshold warnings and bounded same-session growth samples.
- [x] Implement pure `statuslineDiagnostics(payload, previous?, now?)`, plus opt-in persistent sampling scoped to a session; keep normal statusline reads side-effect free.
- [x] Build Core/i18n/CLI and run statusline tests.

## Task 2 — Evidence-based session diagnostics and dispatch attribution

Files: new `packages/core/src/session-diagnostics.ts`, `session-dispatch.ts`; extend session collection/insight contracts and local API; shared session detail and diagnostics components.

- [x] Add fixtures for Claude/Codex tool events, repeated/large results and explicit/ambiguous cross-tool links; bound retained samples.
- [x] Extract bounded derived metadata while reading existing records; never persist command bodies or tool output. Surface evidence strength, count, approximate size and advice.
- [x] Add an on-demand section to the shared detail UI and preserve all existing actions and relation views.
- [x] Run targeted Core tests and both renderer type checks.

## Task 3 — Range-scoped usage insights

Files: new Core or browser-safe pure insight module, Dashboard insight component, both dashboard entry points and shared locale messages.

- [x] Test significant delta, insufficient comparison coverage, one-day peaks, source/date filtering and zero baselines.
- [x] Compute from the same query range, expose at most three actionable findings with supporting numbers, and carry project/model filters to sessions.
- [x] Verify filtering, scoped navigation and both token-unit preferences in Chrome. Production renderer regression covers empty data and partial costs on both surfaces; Desktop overview loading is confirmed separately.

## Task 4 — Muse collection and quota

Files: new `parsers/muse.ts`, `quota/readers/muse-subscription.ts`; source/type/sync/session/runtime registries, both brand/icon maps and tests.

- [x] Test direct/wrapped events, integer validation, replay, append/partial tail, rewrite and late project metadata; test that quota invokes only `usage --json`.
- [x] Register parser, source discovery/status, session observations and quota descriptor. Preserve cached observation timestamps and unknown identity.
- [x] Verify synchronization and missing/available quota states with synthetic fixtures, then run the existing collection/quota suites.

## Task 5 — Optional Agent integration and handoff

Files: new Core integration types/store/hooks modules, CLI `agent` command, local API/IPC adapters, shared integration settings and handoff UI, optional Claude plugin assets.

- [x] Test exact installation ownership, third-party hooks, invalid JSON, disable/remove, independent toggles, hook event response formats, bounded input and deduplication.
- [x] Implement quota hints, concise-answer guidance and glossary guidance as independent nonblocking hooks. Keep model-generated glossary requests optional.
- [x] Implement selected-session handoff preview and copy, with explicit evidence boundaries and no automatic sending.
- [x] Generate optional Claude pane via the documented Mod interface and local loading instructions; show host quota/context and timestamped local observations. Live Claude plugin rendering remains unverified.
- [x] Verify CLI fixture execution and settings feedback; never install into the user's real Agent configuration during acceptance.

## Task 6 — Quota events and optional window startup

Files: quota shared analysis/types, notification locale catalog, new bounded window-start policy/runner/store and runtime adapters.

- [x] Test depleted transition once per cycle, reset recovery, stale snapshots, identity/routing guards, unknown reset, two owners and failed/uncertain attempts.
- [x] Add depleted event without removing threshold/reset events.
- [x] Add per-provider explicit enablement and an inspectable fixed request. Require owner/production scope and durable deduplication before execution.
- [x] Use injected executors for verification; acceptance must not spend real account quota.

## Task 7 — Desktop panel and appearance

Files: `TrayPopover.ts`, tray renderer, quota preferences/layout helpers, shared appearance control/palette module, both theme hooks/styles/settings.

- [x] Test stored order/density and malformed provider IDs; verify ordering and focus retention in Chrome.
- [x] Add pin/move/compact controls, persisted ordering and a persistent quota overview; retain existing tray toggle and lost-focus behavior when unpinned.
- [x] Add 16 named palette choices with current theme as default and cross-window preference subscriptions.
- [x] Verify Chrome keyboard controls, narrow layouts, theme modes and settings persistence; start the isolated Desktop and verify loaded content.
- [ ] Complete native Desktop pin/drag/blur/restart and cross-window palette acceptance. Native capture timed out and native input did not yield a verifiable change. No pass claim is made for these interactions or for all 16 palette combinations.

## Delivery checks

- [x] Update UI, runtime and integration documentation alongside their implementation.
- [x] Run appropriate Core/CLI/Dashboard/Desktop tests and builds/type checks; investigate baseline failures separately.
- [x] Independently review the runtime/collection/UI changes, then resolve the reported findings with regression coverage.
- [x] Actual Chrome acceptance with screenshots, isolated Desktop startup and production renderer smoke checks; native interaction limitations are recorded above.
- [x] Complete final diff/Changeset checks and stop the task-owned CLI/Desktop services; leave the branch/worktree intact.
- [ ] Remove task-owned dependency installation backups. Automatic approval rejected the deletion with `blocked by policy`; the ignored backups are retained.

## Environment observations

The default shared TypeScript directory was present but missing package files, so baseline build could not find `tsc`. This worktree uses a task-local store/link directory under `.quotern-dev/` while retaining the configured global-virtual-store mode; no dependency versions or shared package files were changed.

## Execution evidence — 2026-11-06

| Check | Observed result |
| --- | --- |
| `corepack pnpm build` | Passed after Chrome acceptance fixes. |
| Final Desktop build/typecheck | Passed after fixing background-panel dismissal when unpinning from the main window. |
| Dashboard and Desktop TypeScript checks | Passed. |
| Core suite | 780 tests: 776 passed, 2 skipped, 2 failed. Both failures were reproduced independently on baseline `866ea41e`: truncated trailing DSH frame retention and the environment-sensitive `NO_PROXY` error type. |
| CLI suite | 90 tests: 87 passed, 3 skipped, no failures. |
| Dashboard suite | 299 passed, no failures. |
| Desktop suite | 47 script checks passed; 826 main checks: 806 passed, 20 skipped, no failures. |
| `corepack pnpm test:session-detail-ui` | 35 production renderer checks passed; screenshots reviewed for Desktop light/dark/narrow layouts. |

Chrome used isolated synthetic source logs and quota executables. Verified Muse totals/quota, range/source-sensitive insights, date-preserving links, explicit cross-tool detail links, evidence disclosures, edited handoff saving, independent preference toggles, sandboxed Hook install/remove, plugin preparation, ordering/compact controls, localized number formats, Chinese/English and 390 px layouts. Fixes made during acceptance include the overview report request, HeroUI control anatomy and focus retention after asynchronous operations. Browser error logs were empty at the final check.

The independent reviews led to fixes for Codex provider/account binding, Windows empty argument and exit-code preservation, the supported Claude Mod request shape, consistent Muse replay ownership, Antigravity detail routing and partial-price attribution. Real credentials and paid model requests were not used. Claude plugin loading/rendering, real Muse versions/accounts and actual quota-window startup remain external integration limits.

Local logs are under `.quotern-dev/usage-improvements/`; production renderer regression evidence is under `.quotern-dev/session-detail-ui-1793954644489-5812/`. These are ignored verification artifacts, not shipped application data.

Both development supervisors recorded `stopped` with exit code 0 and were no longer alive after Ctrl+C cleanup. Temporary dependency backups remain under `.quotern-dev/dependency-backups/` because the cleanup deletion was rejected; the active task-local store and links are retained for subsequent work.
