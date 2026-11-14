# Session Analysis Memory Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. Main owns semantic edits; delegated investigation and review are read-only.

**Goal:** Release obsolete session-history graphs after refresh without reducing information.

**Architecture:** Snapshot validity tokens live outside the serializable history objects. Collector and query caches retire expired generations, with bounded in-operation retries and uncached handling for capacity eviction.

**Tech Stack:** TypeScript, Node.js, Electron utilityProcess, existing node:test suites.

**Spec:** `docs/superpowers/specs/2026-11-14-session-analysis-memory-design.md`.

## Constraints and review focus

Keep Desktop isolation, response shapes, full history, source filtering, current titles/prices and response mutation isolation. Do not change heap limits, dependencies or user data. Check overlapping source sets, deletion/corrupt recovery, concurrent stale reads, collectSince/pricing changes during awaits, and more sources than cache capacity.

## Task: Retire obsolete histories

- [x] Add a subprocess memory regression using actual snapshot reads and repeated updates; run it against the old code and observe retained-heap growth.
- [x] Add functional regression cases for stale concurrent reads, deleted/corrupt sources and capacity eviction.
- [x] Modify `packages/core/src/session-collector.ts`: associate lightweight tokens with actual snapshots, retire affected history combinations, and distinguish stale versions from uncached data.
- [x] Modify `packages/core/src/session-query.ts`: prune before/after reads, invalidate bucket/collectSince/pricing generations and bound retries without self-waiting.
- [x] Run Core query/collector/backup and Desktop host/service regressions, package tests, typecheck and build.
- [x] Repeat the original large-history memory experiment and compare session/result digests; run actual Desktop responsiveness acceptance.
- [x] Update runtime notes with current behavior and evidence limits; obtain independent read-only review, resolve findings and commit only this task.
