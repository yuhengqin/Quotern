# macOS ad-hoc release mode implementation plan

**Goal:** Build separate ARM64/x64 DMG and ZIP files without paid Apple credentials, use manual updates, and preserve the signed/notarized release mode.

**Architecture:** Select `adhoc` or `signed` explicitly, defaulting current macOS packaging and CI to `adhoc`. Keep the base signed configuration and apply mode-specific builder overrides. Embed `quoternMacosReleaseMode` in the packaged package.json, verify it in original/ZIP/DMG apps, and bind the selected mode to the verification report and assembly request. Ad-hoc releases omit macOS automatic-update feeds; their app opens Releases for manual download.

**Spec:** The user explicitly requested both architectures with ad-hoc signatures, no notarization, DMG/ZIP output, manual updates, preserved signed mode, and no push/publication after verification.

## Constraints and review focus

- Preserve the versioned Release notes change in existing commit b317609d.
- Current main is clean; no concurrent development has been established. Work in this checkout; do not touch the other worktree.
- No commit, push, workflow dispatch or Release publication in this task.
- Ad-hoc must not require Apple credentials or accidentally select an installed Developer ID certificate. Use an owned empty signing keychain and a sanitized builder environment.
- Ad-hoc verification checks signature integrity, ad-hoc identity, both architectures, version, embedded update mode, ZIP and mounted DMG. It must not claim Gatekeeper acceptance or notarization.
- Signed mode retains Developer ID/Team ID, hardened runtime, Gatekeeper, notarization/stapling and final updater-file checks; missing credentials must fail, never fall back.
- A mode mismatch or automatic macOS feed in an ad-hoc release blocks assembly. Windows artifacts retain their existing automatic-update behavior.
- Ad-hoc apps make no updater network request, download or installation; existing signed and Windows portable behavior remains covered.
- UI reuses existing buttons/openExternal and four-language catalogs; independent Dashboard remains unchanged.

## Tasks

1. Release mode policy and artifact contracts
   - [x] Add failing tests for mode validation, builder/environment policy, mode-bound proof, manual artifact inventories and assembly mismatch.
   - [x] Implement common policy and mode-aware artifact validation/assembly while preserving signed metadata and Release notes preflight.
2. macOS build and final verification
   - [x] Add failing tests for ad-hoc identity, mode checks and skip-notary command behavior.
   - [x] Add an owned empty keychain, explicit builder flags, embedded package marker, separate output directories and mode-aware ZIP/DMG verification.
   - [x] Add explicit local commands and workflow choice; only signed mode imports Apple credentials, default publication remains disabled.
3. Manual update runtime and UI
   - [x] Add failing tests for immutable package-mode reading, no network/install in ad-hoc, and manual download actions.
   - [x] Add a manual state and translated download entry, preserve automatic and portable flows.
   - [x] Update build/release/source instructions and changeset, including mode switch and Gatekeeper limits.
4. Verification
   - [x] Run focused tests, complete workspace tests/build and Desktop typecheck; validate workflow with actionlint and inspect the staged-independent diff.
   - [x] Run a fresh working-tree source archive build outside `.git`, with isolated store if required.
   - [x] Independent read-only review and targeted fixes. Real Apple tooling/architecture startup remain pending on this Windows host; do not fabricate a macOS verification report.

## Verification record

- `corepack pnpm test`: complete workspace suite passed on Windows, including release policy/artifact tests, source build and Desktop runtime tests.
- `corepack pnpm --filter quotern-desktop typecheck`: passed. The independent source archive check repeats it after a fresh installation and full build outside `.git`.
- `corepack pnpm check:source-archive --working-tree --isolated-store --output .quotern-dev/macos-adhoc-validation-20261022/source-archive.json`: passed; seven workspace links and eight expected build outputs checked.
- `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/release-desktop.yml .github/workflows/ci.yml`: passed.
- Independent release-pipeline and updater/UI reviews found no blocking defects. Added coverage for malformed/missing package metadata and check IPC during metadata loading; corrected an overbroad native-updater comment.
- Browser preview used the actual SettingsPanel and AutoUpdateAction with isolated IPC doubles. Chinese, English, Japanese and Korean manual-update labels/hints rendered; click/Enter actions returned the expected Releases URL without invoking check/install. This is a renderer check, not a native macOS launch check.
- Current host is Windows. Actual ARM64/x64 DMG/ZIP creation, Apple tools and application launch remain unexecuted locally. The macOS workflow now requires mode-specific acceptance before assembly; no workflow was dispatched and no commit, push or publication was performed.
