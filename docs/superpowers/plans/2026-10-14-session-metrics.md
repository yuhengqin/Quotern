# Session metrics implementation plan

**Goal:** Add active duration, total duration, session count and message count cards to Dashboard and Desktop.

**Architecture:** Keep session metadata separate from token buckets. Scan real user/assistant messages with independent, versioned per-source cursors; deduplicate by logical session/message identity, persist metadata without content, and query it through the shared local API. Never infer generation duration from message/request spans.

**Tech Stack:** TypeScript, Node.js, Hono, React 19, HeroUI v3.

**Spec:** User-approved in-chat design: session count, user plus AI logical message count, per-session first/last message duration; unknown active duration renders as an em dash; mirrored Dashboard/Desktop changes.

## Global constraints

- Preserve all existing Token and pricing semantics and user-provided `parsers/` reference files.
- Count real user/assistant messages, excluding tool results, metadata and duplicated stream records.
- Deduplicate across duplicate physical files and fork replay; namespace session identities by source.
- For date ranges, count sessions with messages in the range and measure each session between its first and last messages within that range; never sum daily distinct-session counts.
- Unknown timing stays null. Partial source coverage is explicit, never silently called complete.
- Routine branch work and implementation are already authorized by the user; execute inline without additional approval gates.

## Review focus

- No-token messages still update metrics and notify both runtimes.
- Cross-day sessions and source filters preserve unique identities.
- Appends, incomplete JSONL tails, rewrites and repeated scans remain idempotent.
- Initial session backfill works even when Token cursors are already at EOF.
- Database/parse failures preserve prior metadata and mark coverage incomplete.

## Task 1: Session metadata collection and aggregation

Files: `packages/core/src/session-metrics.ts`, `session-collector.ts`, `session-sources.ts`, `test/session-metrics.test.ts`.

- [x] Add tests for duplicate logical messages, source namespaces, date bounds, unavailable active duration, tool exclusion, repeated scans and restart/backfill.
- [x] Run tests before implementation and confirm missing session behavior.
- [x] Implement browser-safe aggregation and independent local metadata collection, with no persisted message contents.
- [x] Run the focused tests and Core suite.

## Task 2: Shared sync and local API

Files: `packages/core/src/sync/index.ts`, `server/state.ts`, `server/local-api.ts`, `server/sync-on-signal.ts`; relevant CLI/Desktop notification/backoff consumers.

- [x] Test session-only updates, API range/source validation and missing source coverage.
- [x] Add session scan to the common source boundary and include metadata change flags in `SyncResult`.
- [x] Add `/functions/tud-usage-sessions` using persisted metadata, independent of Token aggregate caches.
- [x] Notify and reload on session-only changes; retain HTTP/IPC parity.
- [x] Run Core suite and Desktop typecheck.

## Task 3: Mirrored cards

Files: mirrored `hooks/useSessionMetrics.ts`, `components/DashboardSessionCards.tsx`, `pages/DashboardPage.tsx`, `lib/api.ts`; loading skeleton and a changeset.

- [x] Test formatting, unknown values and partial coverage.
- [x] Add four cards below the existing metrics, with accessible definitions and matching responsive layout.
- [x] Fetch session metrics for the current date/range/source selection, with cancellation and synchronization refresh.
- [x] Verify both typechecks, full repository tests and browser appearance/controls.
- [x] Obtain an independent read-only review, fix material findings, and leave the branch reviewable.

## Verification record

- Core session regression tests: 21 passed, including four independently reviewed correctness issues and their RED-to-GREEN reproductions.
- `pnpm test`: 820 passed, 24 platform/environment skips, zero failures; includes all package builds.
- Dashboard TypeScript and Desktop typecheck passed; the three new mirrored implementation files are byte-identical.
- Browser QA verified both metric rows, 7D/30D changes, Agent filtering and accessible duration help dialogs.
- Local historical metadata was backfilled and inspected through the new API without changing Token accounting.
- No push or integration into main was requested; retain `codex/session-metrics` for review.
