# Quota experience improvements

Implement the ten selected improvements on the current main baseline, preserving existing information and actions. This is an extension of the selected comparison, not a new monitoring backend.

## Design and scope

1. Account management leads with aliases, identity evidence and available allowance. Configuration paths remain accessible in a disclosure. Launch defaults describe future `quotern launch` sessions, never assert that an existing terminal changed identity.
2. Preserve the visible remaining-percent window layout already present in main.
3. Pair projected exhaustion with remaining allowance; keep statistical explanations on demand and do not predict from stale readings.
4. Add 5h/24h/7d/30d history ranges, earlier/later/now navigation and optional comparison. Preserve cycle selectors, unknown beginnings, rollback boundaries and original usage evidence. Comparison segments never interpolate across resets.
5. Extend the existing statusline with optional cached account/quota/reset fragments, compact/detailed presets and a deterministic preview. Rendering performs no upstream account request.
6. Show automatic-window eligibility/waiting reasons and the latest attempt for Claude and Codex. Existing owner, identity and idempotency protections remain.
7. Add per-account alert levels and bounded custom thresholds, retaining default thresholds and reset detection/deduplication.
8. Preserve compact tray behavior, shortcut and existing risk selection; test with the new activity entry.
9. Show a shared observed-session activity list with project, source, tool, explicit waiting/turn-ended states and elapsed time. Never infer success or permission state from ordinary tool results. Reuse existing authenticated hooks/storage and expose the list from existing surfaces.
10. Preserve the settings sidebar organization already in main and put new controls in the corresponding existing sections.

## Implementation and acceptance

- Extend core contracts and add focused behavioral tests for range segmentation, threshold crossings, window state and activity reduction.
- Implement shared components, preserve four locales, formatUsd/token preferences, HTTP/IPC behavior and keyboard/focus.
- Run appropriate Core/CLI/UI tests, full build and Desktop typecheck. Exercise both renderers with synthetic data at wide/narrow widths, including error/unknown/stale states.
- Independently review the completed change, fix actionable findings and create a local task commit. Live credentials, real quota-consuming calls and system hook installation are excluded from synthetic acceptance.

## Verification record

- `corepack pnpm test`: passed, including the complete workspace build and Core/CLI/Dashboard/Desktop tests; platform-dependent skips remain reported by their existing suites.
- `corepack pnpm --filter quotern-desktop typecheck`: passed.
- `node apps/desktop/scripts/run-account-billing-smoke.mjs`: passed for HTTP and IPC, including custom threshold validation/save failure/retry, activity failure/stale/recovery, history comparison/navigation, actual narrow-screen scrolling and window-start diagnostics. Final screenshots: `.quotern-dev/account-billing-ui-1794454941888-21264`.
- `node apps/desktop/scripts/run-keeper-insights-smoke.mjs`: passed for history/unknown starts, account-linked local usage, Token units, four locales, price flows and backup/restore. The history check now opens the observed-interval disclosure to inspect the preserved unknown start. Output: `.quotern-dev/keeper-insights-ui-1794454941684-42732`.
- `node apps/desktop/scripts/run-island-ux-smoke.mjs`: passed for preserved quota attention, failure/retry, full analysis, share exports and Windows tray navigation/identity/Escape. Output: `.quotern-dev/island-ui-1794454963371`.
- Independent reviews found and verified fixes for account-rule provider keys/deduplication, bounded activity indexing/migration, tooltip window labels and stale-state presentation. Live UI runs also found and fixed focus loss after history navigation and activity retry. Screenshots were checked for readable account/activity/history/diagnostic content and narrow-screen overflow; below-fold content was exercised by scrolling.
- No real credentials, upstream quota requests, system hook installation or native notification delivery were used for acceptance. macOS/Linux terminal behavior still needs those environments.
