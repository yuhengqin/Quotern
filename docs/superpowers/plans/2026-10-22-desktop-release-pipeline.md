# Desktop release validation implementation plan

> **For agentic workers:** Execute the tasks in order with tests before new script behavior. The primary agent owns implementation and final verification.

**Goal:** Produce named macOS ARM64/x64 packages, validate signed and notarized final artifacts, assemble all desktop assets only after validation, and prove the source archive builds without `.git`.

**Architecture:** Platform builds never publish. macOS validation finishes Apple notarization and stapling before rebuilding blockmaps and update metadata. A separate workflow job assembles verified Windows, macOS and source-check results; its optional publication step creates a draft only after explicit selection.

**Tech stack:** Node.js 22.13+, Corepack/pnpm 11.1.2, electron-builder 26.15.3, Node test runner, Apple command-line tools, GitHub Actions.

**Spec:** User-approved requirements in this file: keep separate macOS ARM64/x64 DMG and ZIP files; preserve Windows four-package delivery and existing installers; use explicit version/platform/architecture names; fail closed on missing Apple credentials, signing or notarization; validate the final app inside ZIP and mounted DMG; validate metadata after all bytes are final; add source build instructions and an archive build without `.git`; do not publish during implementation or validation.

## Global constraints

- Main is clean and has no concurrent development, so use the existing workspace.
- All build/install commands use Corepack/pnpm. Never share writable workspace dependencies or build outputs.
- Keep the complete checked-in dsh-pet vendor snapshot and its licenses in source archives.
- Local source validation includes current uncommitted source; CI validates the exact checked-out commit using `git archive`.
- No push, workflow dispatch, Release creation, or publication in this session.
- Existing per-platform release commands become staging/validation commands with `--publish never`; npm CLI publishing remains separate.

## Review focus

- Missing/partial Apple credentials or ad-hoc/development identities cannot produce a verified macOS release.
- Stapling changes DMG bytes: all blockmaps, hashes and sizes must describe the final files.
- Wrong architecture, stale ZIP contents, path traversal, missing assets, or mismatched source commits must block assembly.
- Archive validation must not reuse checkout `node_modules`, `dist`, `out`, or workspace links.
- Dry runs and tag pushes cannot create a Release; explicitly requested uploads must use a matching version tag and a verified commit.

## Task 1: Release artifact contracts

Files: `scripts/release-artifacts.mjs`, `scripts/release-artifacts.test.mjs`, root `package.json` / lockfile.

- [x] Write failing tests for expected names, complete platform inventories, checksum/blockmap validation, refresh after file mutation, commit/version provenance and assembly rejection.
- [x] Implement streaming hashes, strict update metadata checks, final blockmap regeneration, platform manifests and assembly of known assets only.
- [x] Run the focused tests, including actual builder blockmap generation on small files.

## Task 2: macOS final artifact verification

Files: `scripts/release-macos.mjs`, `scripts/release-macos.test.mjs`, Desktop builder config and package scripts.

- [x] Write failing tests for credentials, Developer ID/Team/version/architecture checks, rejected notarization, and command order.
- [x] Add explicit names and release signing policy; build with publishing disabled.
- [x] Notarize/staple both DMGs, verify original/ZIP/DMG apps and DMGs, then regenerate and validate final update metadata and platform manifest.
- [x] Verify the policy and orchestration with fixture commands locally; real Apple checks remain mandatory on macOS.

## Task 3: Source archive build

Files: `scripts/check-source-archive.mjs`, `scripts/check-source-archive.test.mjs`.

- [x] Write failing tests for clean archive extraction, current working-tree source inclusion, excluded build outputs, environment isolation and workspace link boundaries.
- [x] Support committed Git archives and an explicit local working-tree archive mode, extracting into a new system temporary directory without `.git`.
- [x] Install frozen dependencies there, check local workspace links, run the complete root build and Desktop typecheck, and write a source verification result.
- [x] Execute a real working-tree archive build on this host.

## Task 4: Unified workflow and documentation

Files: `.github/workflows/release-desktop.yml`, existing CI workflow, root/Desktop package scripts, README, CONTRIBUTING, RELEASE, Desktop README, changeset.

- [x] Add build-and-verify jobs for Windows, macOS and source archives; Apple certificate setup uses an isolated temporary keychain with cleanup.
- [x] Assemble only matching validated platform/source results. Default/tag-triggered runs retain workflow artifacts; an explicit manual option can create a draft Release for a matching tag.
- [x] Document prerequisites, secret names, no-key local source builds, artifact roles, dry runs, and the remaining platform acceptance requirements.
- [x] Run release script tests, workflow syntax/contract checks, repository checks appropriate to the changes, and independent review. Do not publish.

## Verification record (2026-10-22)

- Full `corepack pnpm test` passed, including the complete workspace build and all package suites; platform-specific skips remained.
- After independent review fixes, `corepack pnpm test:release` passed all 21 tests. Fixes cover dual-CPU Sharp staging, the private updater's prerelease `latest` alias, and archiving the resolved immutable commit.
- A final consumer review found that private GitHub asset API URLs bypass NSIS's normal architecture selection. The Windows update event now filters to the running architecture before download. Real provider regression tests and event integration passed; the complete Desktop suite then passed (790 passed, 20 platform skips in the compiled test phase). A fresh source archive build/typecheck was repeated successfully with this change.
- `actionlint` 1.7.12 passed both workflow files; `git diff --check` passed.
- The artifact verifier passed the existing four real Windows packages, their blockmaps and update metadata.
- The first archive install exposed a missing file in the shared pnpm store. `check:source-archive --working-tree --isolated-store` then downloaded into a fresh temporary store and passed installation, all builds, 7 workspace-link checks and Desktop typecheck outside the checkout, without `.git` or old outputs. Report: `.quotern-dev/release-validation-20261022/source-archive.json`.
- This host is Windows. Apple signing/notarization, Gatekeeper and real macOS package execution have not run here; the macOS workflow must execute them with configured credentials before release assembly can succeed.
- No push, workflow dispatch, draft Release creation or publication was performed. The user subsequently requested a local commit of the verified changes.
