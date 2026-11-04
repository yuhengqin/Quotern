# Path compatibility implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement these tasks with test-driven development.

**Goal:** Make the release entry points and session executable checks work with macOS directory aliases and Windows long/short paths.

**Architecture:** Compare real file paths for direct script execution. For session executable discovery, reject paths inside either the supplied project path or its resolved directory. Canonicalize test fixtures where the assertion concerns filesystem identity.

**Tech Stack:** Node.js 22 for development/CI, TypeScript, Node's test runner. Keep the released Node.js >=20.10 compatibility and standalone release scripts.

**Spec:** The user's requested repair and the verified CI failures from run 41020054865: two release checks on macOS and four session-action checks on Windows.

## Constraints and review focus

- Preserve standalone script execution before dependency installation and avoid running CLI entry points when imported.
- Preserve the exclusion of relative PATH entries, project-local shims and executable links into the project.
- Cover both ordinary symlink resolution and `--preserve-symlinks-main`.
- Do not change the session-action API's recorded-directory contract or shell argument handling.
- Publish only this fix to a CI verification branch; preserve the existing unpushed local commits.

## Task 1: Release script entry points

Files: `scripts/check-source-archive.mjs`, `scripts/npm-release.mjs`, and their existing test files.

- [x] Add real directory-alias subprocess cases; verify archive help is emitted and npm preflight creates the expected output file, including with `--preserve-symlinks-main`.
- [x] Run the two test files with Node 22 and confirm the alias cases fail on the current implementation.
- [x] Resolve both the invoked file and module file before deciding whether to run `main()`; keep imports inert and scripts dependency-free.
- [x] Run `corepack pnpm test:release` and require zero failures.

## Task 2: Session executable paths

Files: `packages/core/src/session-actions.ts`, `packages/core/test/session-actions.test.ts`, `packages/core/test/session-actions-api.test.ts`.

- [x] Add a directory-alias case that must reject project-local executables and still find an independent installed CLI.
- [x] Canonicalize temporary fixture roots for directory-identity assertions without weakening the assertions.
- [x] Compile and run the two session-action test files; confirm the new alias exclusion fails before the production change.
- [x] Resolve the project root before containment checks, checking both its original and resolved forms; fail closed when the directory cannot be resolved.
- [x] Run the focused tests and full Core tests with Node 22 and require zero failures.

## Verification and delivery

- [x] Run the repository build and complete root test command with Node 22; record any unrelated failures by name.
- [x] Review the diff independently for path containment and standalone-script regressions.
- [x] Commit the reviewed fix and run the existing three-OS CI workflow on a branch containing only this fix.
- [x] Require real macOS and Windows CI success before reporting both platforms verified.

## CI follow-up: deterministic browser smoke locale

The first real run passed on macOS and Ubuntu. Windows passed the original path checks, then exposed an unrelated quota snapshot timing failure; that test passed on retry. The retry reached the browser smoke test and failed because the fresh browser inherited English from the runner while its selectors expected Chinese.

- [x] Force an English host locale and reproduce the missing browser fixture preference as an explicit locale assertion failure.
- [x] Initialize the browser's origin storage to Chinese before loading it; retain the later English scenarios and all existing assertions.
- [x] Build the isolated CI checkout and pass all 34 UI smoke groups with the English host locale.
- [x] Run the complete three-OS workflow on the final commit.

## Verified results

- Windows with Node.js 22.23.4: `corepack pnpm test` and Desktop type checking passed, retaining the existing platform/permission skips.
- `corepack pnpm test:session-detail-ui` passed all 34 groups on both the isolated verification checkout and local main, with the host locale forced to English.
- [CI #19](https://github.com/yuhengqin/Quotern/actions/runs/41770467663), code commit `81074b931b028fb25872e87f77c9bdef20378a85`: macOS passed in 3m 28s, Windows passed in 5m 46s, Ubuntu passed in 1m 59s. The complete run succeeded without a retry.
- Only the task's changes were pushed to `codex/path-compatibility-ci`; `origin/main` and the pre-existing unpushed local commits were preserved.
