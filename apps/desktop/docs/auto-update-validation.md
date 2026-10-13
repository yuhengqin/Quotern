# Automatic update recovery validation

Date: 2026-09-07. Scope: PR #84 / issue #83 review changes. The recorded results below belong to that revision and its presentation follow-ups; they are not a test report for the current source tree.

## Expected behavior

- A newer release downloads automatically for installed builds (`autoDownload = true`). Current Windows portable builds check for updates but require a manual portable-package download.
- Download completion automatically attempts installation and restart.
- An error or the 30-second exit watchdog restores runtime, heartbeat, window
  close behavior, and the downloaded update's manual restart action.
- One manual restart request retries the downloaded package; there is no
  download confirmation, update dialog, or version-skipping workflow.
- The toolbar shows progress or restart/retry. Settings keeps Check for Updates
  in its header and displays the matching progress/restart button beside it,
  with aligned version rows and no separate download progress bar or paragraph.

## Fixes covered

- Defer update startup until runtime and windows have initialized, including
  when the update is already cached.
- Keep update IPC and the watchdog registered when `before-quit` is cancelled;
  perform irreversible handler disposal at `will-quit` instead.
- Acknowledge install IPC without awaiting preparation. Each attempt has its
  own identity, preventing a late timed-out preparation from installing during
  a newer attempt. Recovery and manual retry are serialized.
- Reset the electron-updater 6.x BaseUpdater installation latch after recovery,
  so its first manual retry is not discarded as an already-launched install.
- Restore the main window, runtime watchdog, and runtime
  after a failed update attempt.
- Consume automatic download promise rejections while retaining updater error
  events and retry actions.

## Automated checks

Run from the repository root:

```sh
pnpm --filter quotern-desktop test
pnpm --filter quotern-desktop typecheck
pnpm --filter quotern-desktop build
git diff --check
```

The checks passed in the recorded 2026-09-07 run. That run contained 25 tests:
13 shared UI-state tests and 12 tests of the actual main updater module with
mocked Electron/updater boundaries. Rerun the commands above for the current
tree; the test count changes as coverage grows. The recorded tests cover startup
configuration, automatic install, duplicate requests/events, refusal to install
an undownloaded release, preparation/native errors, timeout, late completion,
recovery serialization/failure, download rejection, disposal, and the
BaseUpdater latch. Timers are advanced deterministically in timeout tests.

## Signed package validation

The native installation results below were recorded on revision `4410631`,
before the subsequent Settings-only presentation adjustment.

Environment: macOS arm64, Electron 35.4.0, electron-updater 6.8.9, Apple
Development-signed packages and a localhost generic feed. The low package is
0.1.8 with these PR changes; the high package is the existing isolated main-based
0.1.9 build. Bundle identity, runtime data, user data, updater/ShipIt caches,
and process ownership are isolated from the regular application. Login-item
changes and hook installation are disabled in the lab.

Fault injection and event logging exist only in the lab build, not in product
code. The preparation fault leaves the first `beforeInstall` promise unresolved
after the real runtime stop. The exit fault cancels the first `before-quit`
event after Squirrel has staged the actual signed update and closed windows.

| Scenario | Result |
| --- | --- |
| Normal automatic update | Pass: startup requested the ZIP without a download click; one automatic install call replaced 0.1.8 with 0.1.9 and relaunched with a fresh runtime owner and heartbeat (3.619 seconds from install call to new-process boot). |
| Preparation never completes | Pass: the 30-second watchdog restored runtime and the enabled Settings restart button. One Settings click installed the already-downloaded package and relaunched 0.1.9 (3.963 seconds from manual install call to new-process boot). |
| First native exit cancelled | Pass: the old process stayed alive after the injected cancellation; timeout restored runtime, heartbeat, main window, and the toolbar restart action. One toolbar click produced the second install call and successfully relaunched 0.1.9 in 2.989 seconds, without downloading the ZIP again. |

Evidence consists of updater/native lifecycle events, HTTP requests, process
snapshots, `Info.plist`, runtime PID/heartbeat files, and ShipIt logs. Actual
toolbar/Settings controls were operated through the native UI, not by invoking
IPC from a test script. Source inspection and the registered-channel test also
confirm removal of the version-skip and manual-download state/IPC/preferences
chains; the lab does not create skip preferences.

## Settings presentation follow-up

Rebuilt and signed the isolated 0.1.8 package with the subsequent Settings UI
changes on 2026-09-07. Automated checks above were rerun. Native UI interaction
confirmed that a no-update response leaves only Check for Updates and the current
version. After the local feed offered 0.1.9, one click on Check for Updates showed
the adjacent download button and latest-version row without opening an update
dialog. The button reached 40%, matching the outer toolbar; visual inspection
confirmed the standalone progress bar and download paragraph were absent and
both version rows remained aligned. The real signed ZIP transfer was throttled
by the lab server to preserve this screenshot state.

After the subsequent restart-action wording and warning-card changes, another
signed 0.1.8 build reached the downloaded/retry state through the lab's one-time
preparation timeout. Native UI inspection confirmed both actions read
"更新并重启", the Settings action remained enabled, and the restart-warning card
was absent while both version rows remained visible. Tests, typecheck, and build
passed again. The final install click was left to the user. These presentation
follow-ups did not rerun native installation; updater control flow was unchanged.

## Limits

- The injected failures are reproducible recovery tests, not a claim that every
  historical production restart failure has been reproduced.
- The preparation fault does not simulate a permanently blocked OS filesystem
  operation inside runtime shutdown or startup.
- Windows/Linux native installation, production notarization/signing identities,
  GitHub release access, and multiple competing production processes still need
  their own release validation. The BaseUpdater latch currently has automated
  boundary coverage, not a native Windows installation run.
- Existing historical lab runs before this review revision are not counted as
  current validation. The low package preserves isolation instrumentation;
  the main-based high package intentionally retains its existing UI.
