# Usage integrity and read-only reporting implementation plan

> **For agentic workers:** Follow the repository role and ownership rules. The primary agent implements semantic changes; mechanical editors perform explicitly assigned transformations; reviewers and verifiers remain independent.

**Goal:** Ship the approved first batch: Codex compressed/compaction metering, explainable costs in Dashboard and Desktop, and read-only CLI/Agent queries.

**Architecture:** Keep parsers, pricing and report aggregation in Core. A pure report query is shared by a local API route and a disk-snapshot CLI command. Both renderers request cost explanations for the same visible date/source range, without changing existing aggregate-cache formats. The CLI never starts a runtime, synchronizes logs, repairs configuration, or fetches remote prices.

**Tech Stack:** TypeScript, Node >=20.10, existing fzstd, Hono, React/HeroUI; development uses pnpm 11.1.2.

**Spec:** User-approved first-batch scope in this chat; this document records implementation decisions and acceptance.

## Global constraints

- Work only in codex/usage-integrity; main contains unrelated ongoing changes.
- Retain normal incremental JSONL behavior, logical byte offsets and existing ledger/fork safeguards.
- Pair compaction response identities, do not reinterpret cumulative ordinary usage as compaction.
- Unknown prices and provenance remain explicit; source-reported amounts are not called payment.
- Pricing metadata reports table publication timestamps when present, not process load time.
- Report dates are inclusive Asia/Shanghai calendar days, default last 7 days; weeks start Monday.
- JSON schema is versioned; text/CSV preserve unknowns. Project filter follows existing normalized project names.
- Mirror UI changes deliberately; preserve Desktop-only behavior. No additional parser in the Agent Skill.

## Review focus

- Same log in different encodings/directories, conversion during reads, corrupted compressed files.
- Compaction before/after marker across scans, token_count overlap, fork replay, ledger leading/lagging.
- Pricing fallbacks, zero reported prices, partial rate coverage, stale/unknown token provenance.
- Invalid dates/options, duplicate bucket snapshots, missing/corrupt config, concurrent queue appends.
- Selected day/range/source changes and stale asynchronous explanation responses in both clients.

## Tasks

- [x] 1. Add matcher identity/table metadata, with focused red/green tests; preserve matching order and cost behavior.
- [x] 2. Add Codex log decoding/discovery; integrate the metering parser and persist compaction evidence; test replay and ledger boundaries. Keep the independent message/session consumer on its existing plain JSONL discovery path.
- [x] 3. Add cost explanations and provenance handling; test default/unknown/mixed coverage and publication metadata.
- [x] 4. Add pure report query plus read-only snapshot loading and local API endpoint; test range/source/model/project and time grouping.
- [x] 5. Add strict CLI grammar, text/JSON/CSV output and packaged Agent Skill; exercise commands against temporary fixtures with before/after filesystem checks.
- [x] 6. Add synchronized Dashboard/Desktop explanation UI using existing API transports and filters; typecheck and inspect rendered interactions.
- [x] 7. Run targeted and repository checks, independent review, document behavior and add changeset; leave reviewable branch without incorporating unrelated changes.

## Acceptance evidence

- Repository `pnpm test` passed, including build, development-runtime checks and package suites. After review fixes, Core tests were recompiled and rerun: 547 passed, 1 skipped; CLI: 31 passed, 3 skipped. The four Codex suites independently passed all 56 cases.
- Independent metering review found two replay/upgrade boundary bugs; both were reproduced with failing regressions, fixed and independently verified. Report review found a stale-response issue; both clients now invalidate reports when the filter or overview snapshot changes.
- Final Dashboard and Desktop builds and Desktop typecheck passed; the final Dashboard suite passed all 155 tests. Browser checks used isolated synthetic rows: all sources $0.96 / 450K tokens, Codex $0.56 / 150K; price table, default share, recorded/estimated provenance, date scope and Escape focus return matched expectations.
- A 4-second network delay verified Codex → all → Codex shows loading instead of an old report. Browser verification also exposed the existing token-share cost scaling; local cost cards now use the report subtotal, with unavailable filtered cost comparisons omitted.
- The packaged Skill passed validation, npm pack dry-run included it, and actual CLI subprocess tests verified snapshot queries leave config, queue and runtime ownership unchanged.
- Desktop native-window interactions were not exercised. Builds/typecheck and the repository Desktop test suite passed; the browser interaction evidence applies to Dashboard and the shared explanation component.

## Known boundaries

- Compressed archive support covers token metering; independent session/message indexing remains plain JSONL.
- Ledger totals have no response identity. Pending compaction coverage uses a documented conservative overlap policy; ledger gaps emitted before the corresponding request record cannot be exactly attributed retroactively.
- Historical buckets without token provenance remain unknown. Reports are persisted/runtime snapshots, not billing records or a cross-file transaction.
