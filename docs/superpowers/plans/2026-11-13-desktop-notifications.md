# Desktop notifications implementation plan

> Execution: superpowers:executing-plans, in this chat. The user approved the recommended approach and waived further design confirmation. Side-chat rules prohibit subagents; implementation and review stay local.

**Goal:** Make notifications independent of pets, with sounds, per-event delivery policies, precise navigation and Codex/Claude completion, confirmation and error events.

**Architecture:** A Desktop notification manager owns delivery, policies, sound and dismissal. A shared activity runtime feeds that manager and optionally the pet. Incremental logs supply explicit events; the existing opt-in Agent integration hook supplies reliable permission/question/failure events without saving prompts or tool payloads.

**Tech stack:** Existing Electron 35, TypeScript, React 19, HeroUI 3.2.4, Node tests and isolated Desktop UI checks. No new dependency.

**Spec:** User request in this chat and approved direct implementation. Routine defaults below are implementation decisions.

## Global constraints

- Work only on `codex/desktop-notifications`, based on `ae984c89`; preserve main and other worktrees/services.
- Use `corepack pnpm`; keep the lockfile and workspace dependency contracts.
- Preserve quota/reset/service switches and account rules, pet activity and exact session navigation.
- Never auto-approve Agent actions. Clicks open Quotern's exact collected session; resolved requests dismiss old notifications.
- Never infer goal success, API failure or approval solely from silence, command output text or a tool call requiring no approval.
- Hook installation remains explicit and preserves other hooks. Isolated development cannot modify real Agent configuration.
- Four UI languages; reusable FilterMenu and current settings layout; feedback stays next to the operation.
- Default Agent modes: background. Quota/service: always (preserve current delivery). Sound: soft, with bell and none options. Preserve a legacy explicit Agent mute.

## Review focus

- Cold start/truncated logs and stale/duplicate records must not replay old notifications.
- Hook and log events for one turn/request must not duplicate or retract unrelated sessions.
- Failed settings writes retain the effective old preferences; corrupt preferences fail closed and show a recoverable error.
- A notification clicked while the renderer is closed/loading must retain its exact target until acknowledged.
- Delivery failure/disposal/suppression must not produce a late sound or resurrect an old notification.

## Tasks

### 1. Notification events and activity lifetime

Files: `apps/desktop/src/shared/agent-activity.ts`, `main/agent-activity/*`, compatibility exports under `main/dsh-pet/`, existing activity tests.

- [x] Add failing assertions for Codex turn completion, explicit request/error records, Claude end-turn/question/API error records, and non-terminal/tool-output exclusions.
- [x] Extract the common activity monitor and parser; preserve pet state semantics and append a separate notice signal.
- [x] Start the activity stream independently; allow the pet to subscribe without controlling notification lifetime.
- [x] Run focused parser/monitor and pet regressions.

### 2. Reliable hook events

Files: `packages/core/src/agent/{notifications,hook,install,preferences}.ts`, core hook tests.

- [x] Test metadata-only completion/confirmation/error/resolution mapping and unsupported/cancelled cases.
- [x] Add opt-in notification collection to the existing integration hook, bounded atomic event files and pruning.
- [x] Register only officially supported events per provider; preserve existing feature hooks and configuration ownership.
- [x] Add an incremental Desktop event reader; test startup baselines, duplicates and out-of-order records.

### 3. Delivery, preferences and sound

Files: `apps/desktop/src/shared/notifications.ts`, `main/notifications/{manager,preferences,sound,runtime}.ts`, tests, quota adapter.

- [x] Test off/background/always, confirmed show vs requested delivery, sound, deduplication, replacement, resolution, failed sends and disposal.
- [x] Persist validated preferences atomically; migrate explicit old Agent mute and surface load/save errors.
- [x] Generate original short PCM chimes; use a hidden Windows SoundPlayer subprocess and macOS/Linux adapters, with bounded lifetime and overlap protection.
- [x] Route existing quota/service notifications through the common manager, retaining quota test IPC compatibility.

### 4. Interaction and settings

Files: Desktop preload/types, AppShell, settings navigation and `NotificationSettings`, localized messages; dsh-pet service/controller/index.

- [x] Move navigation ownership into notification runtime; keep compatibility with old preload callers.
- [x] Add a notification settings tab: modes, sound/preview/test, explicit Agent hook connection and nearby failure feedback.
- [x] Remove pet-owned delivery and its duplicate setting; continue forwarding activity to the running pet.
- [x] Verify keyboard selection, saved preferences, rejected writes, narrow layout and exact click navigation.

### 5. Verification and handoff

- [x] Run core and Desktop tests, typecheck, applicable localization checks and production builds.
- [x] Run isolated UI/native checks with controlled events, pet disabled, and no real Agent configuration writes.
- [x] Review the complete diff for races, privacy, bounded resource use and functional preservation.
- [x] Update Desktop README and UI guidelines; record actual validation and limits, then create a local atomic commit. Do not merge or push.

## Execution notes

- Initial baseline was blocked by missing files behind existing global pnpm dependency links. Standard and forced installs did not repair them. To avoid touching shared state used by other worktrees, verification uses a pnpm-managed task-local store under ignored `.quotern-dev/`; old task-owned entrances are retained there as backups. Workspace configuration and lockfile remain unchanged.
- All five implementation tasks were completed in the isolated worktree. Self-review covered the full diff; no subagent was used, as required by this side conversation.
- Regression fixes include a new short-lived session's first event, long session metadata retaining the real session ID, exact request resolution with a missing Codex call ID, no unrelated question dismissal, cross-stream lifecycle ordering, and explicit test notifications surviving focus reconciliation. Each was reproduced with a failing test before its fix.
- Current official Codex protocol/persistence sources confirm durable terminal errors on `TurnCompleteEvent.error`, while standalone Error events are transient. Both `task_complete` and `turn_complete` are supported; older versions without durable error details have a documented detection limit.

## Final verification

- `corepack pnpm test`: exit 0 on the final code including live-test fixes; 2,285 passed, 37 environment-dependent skips, zero failures across root checks and all workspace packages. This also built Core, i18n, Dashboard, CLI and Desktop successfully.
- `corepack pnpm --filter quotern-desktop typecheck`: exit 0.
- `corepack pnpm test:notifications-ui`: exit 0; ten checks passed using the production notification runtime, real preload and React UI, controlled log events and no pet subsystem. Includes exact navigation before renderer mount, repeated clicks, window rebuild/latest target, missing-session behavior, keyboard policy saving, rejected writes, Windows audio preview, native Notification object/handlers and narrow layout.
- Final UI artifacts: `.quotern-dev/notifications-acceptance-1794544238361/`; the expected injected save failure is captured in the test log and handled by the UI. Native interaction and sound evidence are recorded separately below.
- `git diff --check`: clean. No new dependency or lockfile change; no real Agent configuration was modified.
- Limits: the automatic UI test captures `show()`; Windows native delivery was additionally verified in the live phase below. macOS/Linux playback and real cloud-model inference were not exercised. No package release or installed-client update was performed.
- Handoff: retain `codex/desktop-notifications` and its worktree for review; local atomic commit only, no merge or push.

## Windows live follow-up (2026-11-13)

- Real installed CLIs: Codex 0.167.1 and Claude Code 2.1.322. Their runtime, hooks, approval requests, harmless tool execution and transcripts were real; model output and API failures came from a deterministic localhost endpoint with dummy credentials. No main-user Agent configuration or trust store was changed.
- Six scenarios passed: both providers' completion, confirmation and API error. The evidence checker found exactly one matching native send per scenario despite duplicate Hook/log signals. Metadata: `.quotern-dev/notification-live-verification.json`; native records under `notification-native-live-20261113-{branded,final,retraction}`.
- User feedback and screenshots confirmed visible Windows toasts and audible sound. Actual native click callbacks carried the exact source/session ID; the user observed the real session detail after the private collector caught up. The harness now collects its private CLI logs automatically, independently of production data.
- Native history comparisons proved that both providers' pending approval Tags disappeared after PostToolUse, including after banner timeout, while unrelated entries remained. The notification center UI was disabled by the user; no system setting was changed. Soft sound, bell preview and a silent test notification were also checked through production IPC/player paths.
- Fixed and reproduced with failing regression tests: (1) Windows banner `close` must retain a bounded history object for click/retraction; (2) a quiet SessionEnd must not discard an earlier durable Codex API failure; (3) the Windows process AppUserModelID must match the installer. Hook installation is now labelled accurately, with Codex review/trust instructions.
- All owned acceptance processes stopped. The three unique test AppUserModelID registrations were removed; final native history was `[]`. Only the two known baseline-test Tags under the initial Electron identity were explicitly removed. Private evidence files remain ignored in the worktree.
