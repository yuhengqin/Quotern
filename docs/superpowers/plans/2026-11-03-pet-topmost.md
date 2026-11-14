# Pet topmost recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this single task. Steps use checkbox syntax for tracking.

**Goal:** Restore atlas pets above ordinary Windows applications when native z-order drifts, including when the topmost flag remains true.

**Architecture:** Keep recovery in PetController. Reassert `setAlwaysOnTop(true, 'screen-saver')` immediately after showing and once every five seconds while visible; clear the interval on hide, close and disposal. Preserve inactive display, pointer capture, transparency, dragging and docking.

**Tech stack:** Electron 35.4.0, TypeScript, node:test and the existing private-profile native pet fixture.

**Spec:** The recovery approach discussed and approved in this chat on 2026-11-03. The original trigger remains unproven; this change repairs the observed inconsistent state.

## Constraints and review focus

- Work only in this isolated worktree; do not replace the installed application or touch its profile.
- Keep mouse input and pet selection behavior intact; no renderer/API/settings changes.
- A true `isAlwaysOnTop()` result must not skip recovery.
- Hide/reshow and close/recreate must not retain or duplicate timers.
- Native recovery must preserve bounds and the foreground window.

## Task: Recover native topmost through the pet lifecycle

Files: `apps/desktop/src/main/pet-controller.ts`, `apps/desktop/src/main/pet-topmost.test.ts`, the existing `apps/desktop/scripts/pet-pointer-native.ts` fixture, a fixture-only Win32 helper, and `apps/desktop/README.md`.

- [x] Add lifecycle regression tests and observe the expected failure before the production change.
- [x] Add the visible-only five-second recovery interval with immediate restoration and lifecycle cleanup.
- [x] Verify the new tests, Desktop test command and Desktop typecheck.
- [x] Extend the existing native fixture to demote its own native window and simulate a stale Electron topmost query; check actual z-order, bounds, no pet activation and hidden/reopened behavior, retaining existing pointer checks. Direct style-bit forging was attempted but did not reproduce the original state reliably.
- [x] Document the behavior and native acceptance command, review the final diff independently, and report actual verification limits.

## Verification

- Desktop test: 34 script checks plus 804 tests passed; 20 existing upstream checks skipped, zero failures.
- Desktop typecheck and production build passed. The build retains pre-existing dynamic-import and cross-volume font-path warnings observed in the baseline build.
- The private-profile Electron fixture passed all 13 checks. Final evidence: `apps/desktop/.quotern-dev/pet-pointer-smoke-I03zqx/result.json`.
- Independent review findings were addressed: explicit Windows scope, no false focus failure when the operator changes windows, stale query installed before native demotion, and explicit native topmost assertions on hide/reshow.
- The installed Quotern executable and live profile were not replaced. The original Windows failure trigger remains unproven; the native test validates recovery from controlled demotion with a simulated stale query.

## Main integration verification — 2026-11-15

- Merged original commit `67a603d5` into main based on `1999e760`, preserving the current shared pet menus and activation coordinator.
- Desktop script checks: 47 passed. Compiled Desktop/upstream tests: 886 passed, 20 existing upstream skips, zero failures. Desktop typecheck and production build passed.
- Windows native atlas fixture passed all 13 checks, including actual z-order recovery, unchanged bounds, no activation, hidden/reshown behavior and existing pointer interactions. Evidence: `apps/desktop/.quotern-dev/pet-pointer-smoke-Tsypqz/result.json`.
- Generated `out/dsh-pet/runtime/topmost-watchdog.js` matched the vendor source and retained its five-second recovery interval. The real main/preload/helper menu fixture passed all 21 checks, including cross-kind exclusivity, native menus, animation, sizes, language, theme and hide/reshow. Evidence: `apps/desktop/.quotern-dev/pet-menu-ui-1794697621350/result.json`.
- Updated that menu fixture's old size expectations to the current `204/264/364` presets. The older standalone `native-dsh-pet-smoke.ts` fixture still expects a renderer DOM menu and lacks the current host context-menu provider; it was not used as the final helper acceptance gate.
- Independent read-only review found no blocking issues. No installed application/profile changes or other-platform/package acceptance were performed; the original spontaneous Windows failure trigger remains unproven.
