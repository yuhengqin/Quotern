# Shared Background Library Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Primary agent owns implementation; read-only specialists may investigate or independently review bounded work.

**Goal:** Share one persistent Core background library between browser panels and Desktop, with safe legacy migration.

**Architecture:** A locked file store under dataDir backs the existing local-api. UI uses its normal HTTP/IPC transport, with read-only adapters for legacy IndexedDB and Desktop JSON.

**Tech Stack:** TypeScript, Node, Hono, proper-lockfile, React, Electron.

**Spec:** ../specs/2026-10-14-shared-background-library-design.md

## Global Constraints

- Three saved backgrounds, 2 MB per cropped image, existing crop workflow and session-local selection.
- Node >=20.10 for published artifacts; no cloud service or direct renderer filesystem access.
- Every read/mutation sees committed disk state; cross-process writers must coordinate.
- Migration preserves legacy sources and never silently replaces existing shared images.

## Review Focus

- Concurrent CLI observer and Desktop writes cannot exceed capacity or lose other changes.
- Migration acknowledgements survive retries and deletion; old backups must not resurrect deleted assets.
- Full gallery or invalid legacy data must not disable valid shared gallery operations.
- Focus refresh cannot race writes or reset an existing manual selection.
- Invalid image bytes, request sizes and broken persisted data cannot overwrite valid stored state.

## Task 1: Core storage and local API

Files: core/src/share-backgrounds.ts, core/src/server/share-background-api.ts, local-api.ts, http-server.ts, index.ts; core/test/share-backgrounds.test.ts and fixtures/share-background-writer.ts.

- [x] Add API integration tests and observe missing-route failures.
- [x] Implement validated binary storage, versioned index, cross-process locking and atomic commits.
- [x] Implement list/add/remove/touch/import routes with bounded JSON and error envelopes.
- [x] Verify actual disk sharing, failed mutations, deduplication, capacity, receipts and process concurrency.

## Task 2: Shared UI transport and legacy migration

Files: both lib/api.ts adapters, dashboard/lib/share-backgrounds.ts, new dashboard/lib/share-background-migration.ts and tests; useShareBackgrounds.ts, ShareBackgroundPicker.tsx; Desktop main/share-background-ipc.ts, share-background-store.ts and tests, shared/share-backgrounds.ts, preload/index.ts, renderer/global.d.ts.

- [x] Test migration coordination before implementation, including retries and full galleries.
- [x] Expose a shared API request helper in each transport adapter; move normal background operations to Core.
- [x] Make Desktop legacy bridge read-only; import both legacy sources via Core while retaining backups.
- [x] Show pending/error migration notice with retry; refresh on focus while preserving valid selection.
- [x] Verify Desktop legacy fixtures and shared Dashboard exports; no duplicate UI implementation.

## Task 3: Acceptance and delivery

Files: development/architecture notes and a user-facing changeset.

- [x] Update storage, transport, migration and backup documentation.
- [x] Run pnpm test and Desktop typecheck; run HTTP probe with isolated data directory.
- [x] Independently review concurrency, error handling and migration data preservation; resolve actionable findings.
- [x] Inspect final diff and report actual verified behavior and any remaining environment limits.

## Review rulings

- JPEG dimensions use the library's `jpg` spelling; regression uses an actual JPEG crop fixture.
- Header checks alone accept truncated PNGs. Validate full pixels with Sharp before any commit; published Node floor is now 20.10.
- Electron nativeImage cannot decode WebP (verified in Electron 35), so all hosts use the same Core Sharp decoder. Keep Sharp external and unpack native resources; prepare both mac CPU packages at install time and verify packaged dependencies.
- Standard production dependency collection follows workspace Core outside the Desktop directory and fails asar packaging. Stage Sharp's installed dependency closure under out/native-runtime and map it to packaged node_modules; retain the existing exclusion of automatic dependency collection.
