# Quota Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver read-only quota CLI/MCP, safe source diagnostics and Gemini CLI quota support.

**Architecture:** Core owns readers, diagnosis and snapshot projection; CLI/Desktop publish separate safe snapshots. CLI/MCP read without initializing runtime. Explicit CLI refresh uses an already running HTTP runtime.

**Tech Stack:** TypeScript, Node >=20.10 (development >=22.13), pnpm 11.1.2, node:test, official MCP SDK 1.x.

**Spec:** ../specs/2026-10-24-quota-agent-tools-design.md

## Global Constraints

- Work only in task worktree; no merge/push. Preserve existing reader/account/backoff semantics.
- No credential changes or real provider requests during tests. No source imports from caut.
- Dashboard/Desktop renderer parity for Gemini. Snapshot contains no preferences/full paths/raw error text.

## Review Focus

- Missing/corrupt/oversized snapshot must remain unknown and never trigger repair/network (Task 2/4).
- Expired resets or observations must not retain an actionable forecast (Task 2).
- New account must not inherit old successful windows/diagnostics (Task 1/3).
- MCP stdout and shutdown must remain protocol-safe (Task 4).
- Gemini missing/invalid fraction is unknown, valid 0 is exhausted, and model pools are not summed (Task 3).

## Task 1: Safe diagnostics

Files: core quota shared types, capture state, manager, Codex/Claude reader, cache/OMP selection; new core quota-diagnostics tests.
Produces: bounded QuotaReadDiagnostic on provider state; fixed diagnostic attempts through capture context.
- [x] Write and run failing tests for failed HTTP, parallel captures, stale fallback, safe serialized output.
- [x] Implement recording/projection without changing existing refresh and identity behavior.
- [x] Run targeted Core quota tests and Desktop reader regressions.

## Task 2: Public read-only snapshots

Files: new core quota/report.ts and snapshot.ts; runtime.ts; CLI/Desktop runtime initialization; core quota-report/snapshot tests.
Produces: versioned QuotaReport, project/read/filter functions, serialized atomic snapshot publisher.
- [x] Write/run failing tests for safe projection, independent writers, stale forecasts and no-write invalid/missing reads.
- [x] Implement explicit whitelist validation, bounded reads, runtime source selection and publisher.
- [x] Wire CLI/Desktop publication using their shared Core dataDir without sharing preferences/history.

## Task 3: Gemini CLI reader

Files: new core quota/readers/gemini-subscription.ts and tests; runtime/registry; both renderer icon maps and relevant locale contract data if required.
Consumes: safe diagnostic capture; produces generic windows/provenance for existing QuotaManager.
- [x] Write/run failing fixture tests for authenticated query sequence, malformed/missing/zero quotas, expiry, errors, account isolation.
- [x] Implement bounded readonly local credential/settings parsing and two POST queries; no refresh or onboarding.
- [x] Register source and mechanically update both UI mappings; verify focused tests and builds.

## Task 4: CLI and MCP

Files: new CLI quota args/output/command, MCP server, tests; index.ts, help/locales, package.json/lockfile.
Consumes: QuotaReport reader and projections from Task 2.
- [x] Write/run CLI subprocess tests with temporary snapshots and Desktop owner; assert no file writes/network.
- [x] Implement strict args, JSON/text, provider/runtime filters and explicit existing-CLI HTTP refresh.
- [x] Add official SDK/Zod; implement three read-only tools and protocol-safe shutdown.
- [x] Run MCP SDK client integration tests and CLI suite.

## Task 5: Documentation and final verification

Files: CLI.md, quota-management/subscription docs, README where needed, changeset.
- [x] Document limits, snapshot ownership, diagnostics and Gemini source version assumptions.
- [x] Run relevant complete package suites, build, Desktop typecheck and diff checks.
- [x] Independent reviewer checks final diff; resolve actionable findings and rerun affected tests.
- [x] Report branch/worktree, validation and unverified real-account/Electron surfaces.

## Validation record — 2026-10-24

- Core: 650 passed, 1 skipped; the only failure is the existing `qwen3.8-flash` China pricing assertion (actual `0.014844`, expected `0.01187`). Pricing source and assertions are unchanged by this branch. Core script tests: 16 passed.
- CLI: 81 passed, 3 skipped. Desktop: 34 script tests and 796 compiled tests passed, 20 skipped. Dashboard: 238 passed in the earlier full run, before the final Core report fixes; subsequent CLI/Desktop builds both passed.
- Core build, CLI build, Desktop build/typecheck, localization catalogs and diff checks passed. Renderer builds retain unresolved JetBrains Mono font-path warnings plus mixed-import/chunk warnings; runtime font loading was not checked.
- Independent review findings about balance/unlimited semantics, empty snapshots and Gemini project fallback were fixed and covered by regression tests; the bounded follow-up review found no further confirmed defects.
- No real Gemini account/provider requests, browser/Electron interaction, installer or release checks. Changes remain uncommitted on `codex/quota-agent-tools`; no merge or push.
