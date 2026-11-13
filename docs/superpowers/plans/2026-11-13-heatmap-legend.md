# Heatmap Legend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this single scoped task.

**Goal:** Make the calendar heatmap legend clear and consistent in Dashboard and Desktop.
**Architecture:** One shared legend and HelpPopover; independent grids pass their real thresholds and optional footer content.
**Tech Stack:** React 19, HeroUI 3.2.4, Tailwind 4, shared quotern-i18n.
**Spec:** ../specs/2026-11-13-heatmap-legend-design.md

## Constraints and review focus

- Preserve date selection, daily details, source filters, achievement links and theme colors.
- Reuse formatTokens and react to saved unit changes; support all four existing languages.
- Keep range labels truthful for no activity and equal quantiles; retain timezone in help.
- Verify footer reflow, light/dark themes, keyboard opening/closing and focus restoration in both HTTP and IPC renderers.

## Task: shared legend

- [x] Extend the existing Electron acceptance fixture with a heatmap-only mode covering help, real boundaries, responsive footer and display preference updates. Confirm the old renderer fails the new expectation.
- [x] Add ActivityHeatmapLegend; connect both grids and move achievement links into its footer slot. Register Desktop shared CSS source and four-language copy.
- [x] Update UI component documentation and add a patch changeset for both renderers.
- [x] Build both renderers; run Dashboard tests, localization checks, Desktop typecheck, the heatmap acceptance and applicable existing Dashboard acceptance. Inspect screenshots.
- [x] Review the focused diff, fix material findings, and create one local atomic commit.

## Execution notes

- Baseline: 96e7b029. Main has unrelated notification edits; use the isolated codex/heatmap-legend worktree.
- Frozen install completed. Initial Dashboard tests need Core/i18n dist outputs; baseline build supplies them before testing.
- Independent review confirmed compact threshold collisions (1,001,500 / 1,002,250 / 1,002,700 all display 1M). A second UI fixture reproduces the misleading inequality before the fix. Use approximate range copy and an around-value label when formatted boundaries coincide; preserve original thresholds and unit preferences.

## Verification

- Both renderer builds and Desktop typecheck passed; Dashboard tests: 317 passed; localization catalog checks passed.
- `corepack pnpm test:heatmap-legend-ui .quotern-dev/heatmap-legend-verified` passed for HTTP and IPC renderers. The second run with `--heatmap-close-bands` and `.quotern-dev/heatmap-close-bands-verified` also passed. Coverage includes keyboard/focus, 320/375/1120px, four locales, live unit changes, repeated and rounded thresholds, empty source selection, and light/dark screenshots.
- `corepack pnpm test:dashboard-ui .quotern-dev/heatmap-dashboard-regression` passed. Manually inspected wide, narrow, help, and dark screenshots; no legend overflow or missing footer entry was observed in those views.
- The broader `test:island-ux-ui` did not complete: its existing tray fixture logged `options.getAutostart is not a function`, and native initialization stopped responding before renderer checks (including its own deadline). Only the identified acceptance Electron process and its profiled child processes were stopped. No tray/runtime code was changed; this run is not counted as passing.
- Main continued receiving unrelated changes during this task, so keep the validated branch for later integration.
