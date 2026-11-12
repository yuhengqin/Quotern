# Appearance Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add optional Catppuccin, Windows 95 and newspaper styles consistently across Quotern main UI and tray while preserving the default UI and all existing behavior.

**Architecture:** A browser-safe appearance registry/validator supplies shared React styles and native window colors. Browser storage and a serialized Desktop IPC controller provide platform-specific persistence. Keep existing theme-mode resolution and business components.

**Tech Stack:** React 19, HeroUI 3.2.4, Tailwind 4, Electron 35, TypeScript; existing Node and CDP tests.

**Spec:** `docs/superpowers/specs/2026-11-13-appearance-themes-design.md`

## Global Constraints

- Preserve every existing feature and the default appearance; do not copy upstream usage HTML/JS/assets.
- Use `corepack pnpm` 11.1.2; no dependency or lockfile changes.
- Work only in `codex/appearance-themes` and its isolated managed worktree; preserve main's unrelated edits and services.
- Keep existing `system | light | dark` resolution, native window controls, token/cost formatting, filters, and quota order.
- Update the shared UI registry documentation and include a user-facing changeset.

## Review Focus

- An existing saved accent must survive selecting a style, mode changes and a restart.
- Returning to default must remove all extra variables, fonts and material rules in both main and tray.
- Rapid saves, failed writes, reloads and a second window opening must not overwrite a newer preference.
- Paper/retro geometry must not hide quota actions, keyboard focus, scroll regions or long translated labels.
- Style changes with an unchanged light/dark mode must also update native window/titlebar colors.

### Task 1: Shared appearance domain and Desktop persistence

**Files:** Create shared appearance registry and tests, main appearance controller/persistence/IPC and tests; update preload/global types, native window color integration and startup.

**Interfaces:** `AppearancePreferences { style, palette }`; normalization/validation, token resolution, native chrome resolution; Desktop `getAppearance`, `setAppearance`, `onAppearanceChanged`.

- [x] Write behavior tests for legacy/invalid preference normalization, custom accent precedence, default token cleanup, native style colors, serialized persistence and failure without publication.
- [x] Run tests first and confirm missing functionality fails; implement the smallest shared model and serialized controller that satisfy them.
- [x] Wire validated IPC/startup, persistence and window chrome; run relevant unit tests and Desktop typecheck.

### Task 2: Shared settings, runtime and three style treatments

**Files:** Create shared AppearanceProvider/runtime/control/CSS and browser persistence helpers; update PaletteControl, ThemePreferenceControl, both ThemeProviders, Desktop CSS sources, tray CSS, and preference translations.

**Interfaces:** Provider exposes current preferences, immediate selection and save error/retry; runtime applies registry tokens to root, independently of light/dark mode.

- [x] Add focused UI regressions for selecting styles, material borders and header actions; observe failures before fixing the border and contrast regressions.
- [x] Implement browser and Desktop adapters, static previews, theme/accent composition, material rules, and tray integration.
- [x] Verify actual styles, keyboard changes, persistence/synchronization, error/retry, default restoration, supported locales and narrow layouts.

### Task 3: Verification and closeout

**Files:** Add isolated appearance smoke runner, update docs/ui-guidelines.md and a changeset.

- [x] Run root build/tests, Desktop typecheck and the appearance smoke test in a fresh owned output directory; inspect screenshots and relevant existing UI regressions.
- [x] Request one independent whole-branch review and address actionable correctness findings with regression coverage.
- [x] Check diff/ownership and create local atomic commit(s); retain branch/worktree for review, without merge or push.
