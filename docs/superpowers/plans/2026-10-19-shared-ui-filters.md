# Shared UI and Filter Menus Implementation Plan

> Execution: main agent implements in the current session; read-only agents inventory independent areas and review the final change.

**Goal:** Give UI work a maintained component map and required rules, and make bounded, scrollable filter menus the shared default.

**Architecture:** Keep HeroUI selection and overlay behavior. A browser-safe Dashboard module owns Select, Autocomplete and custom option-list popovers; Desktop imports it through a local re-export. Business components continue to own selection state and meaning.

**Tech stack:** React 19, HeroUI 3, Tailwind 4, TypeScript, existing Node test runner.

**Spec:** User-approved design in this chat: inventory public UI, add `docs/ui-guidelines.md` and its mandatory AGENTS.md reference, consolidate filter menus, migrate related consumers, verify in the in-app browser.

## Constraints

- Preserve existing labels, single/multiple selection, all/empty semantics, search, clear, apply/close behavior and session pagination.
- Default option-list popovers to 320px with HeroUI viewport collision handling; keep search/actions outside the scrolling list where present.
- Distinguish cross-end imports from independent copies; include shared classes in Desktop's Tailwind source scanning.
- Calendar editors, calculators, explanatory popovers and native Desktop windows retain their own layout contracts.
- No new product dependency, Skill, release, commit or push is required.

## Tasks

- [x] Inventory existing public and business UI entry points from imports and actual consumers; document boundaries and Desktop ownership.
- [x] Add `FilterMenu.tsx` shared wrappers with typed HeroUI props, centralized height and scroll defaults; migrate related lists in both renderers.
- [x] Add a focused architectural regression check for direct Select/Autocomplete popovers bypassing the public entry; use existing test/CI entry points.
- [x] Write the UI guide with component map, examples, exceptions and browser acceptance cases; add a concise mandatory reference to AGENTS.md.
- [x] Verify Dashboard and Desktop types, relevant existing tests, docs links and the final diff; independently review the shared contract and migrations.
- [x] Use the in-app browser on the existing main Vite/API preview to check price/session/Agent menus, long lists, last-option access, multi-select, search and a short viewport; save screenshots.

## Review focus

- A wrapper must preserve HeroUI's collection discovery, ref, placement and accessible names.
- Search/clear controls must not disappear when the list shrinks in a short viewport.
- A same-named Desktop file may be an independent consumer rather than a shared implementation.
- New pages must find one maintained UI rule document; existing business-only components must not be advertised as universal primitives.
- Automated checks must target the public-entry policy, while browser interaction proves visual and keyboard behavior.

## Validation commands

```text
pnpm --filter quotern-dashboard exec tsc --noEmit
pnpm --filter quotern-desktop typecheck
pnpm --filter quotern-dashboard test
git diff --check
```

Browser and review results are reported in the delivery, separately from automated checks and native Electron validation.

## Recorded validation

- Dashboard and Desktop typechecks passed; Dashboard tests: 222 passed, 0 failed/skipped. Architectural entry check was observed failing at 14 direct popovers before migration, then passing.
- Independent read-only review found no blocking correctness/contract issue.
- In-app browser on main's existing isolated preview (`127.0.0.1:5194`, API `8452`) verified price sort/provider/context, session project/Agent, overview Agent, heatmap, trend and share-range menus. It checked a long list, keyboard end-item selection, search/clear, multi-select, 12-row pagination and Escape/focus restoration.
- At an 800×480 viewport the custom heatmap popover shrank to 210px (174px scrolling body for 252px content); its fixed actions and last option remained accessible, with no background scroll. Temporary viewport overrides were reset.
- Native Electron/tray windows and dormant rank/cascade pages were not exercised. No full repository build, release, commit or push was performed.
