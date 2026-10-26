# Compact picker text implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the implementation and verification checklist below.

**Goal:** Fix clipped session model-filter text and the same fixed-height picker conflict elsewhere in both renderers.

**Architecture:** Keep the existing HeroUI Select/Autocomplete and FilterMenu composition. Pair fixed-height triggers with centered contents and zero vertical padding, and set the displayed value to the intended 12px font / 16px line height. Retain dimensions, labels, selection, popovers and focus behavior.

**Tech Stack:** React, HeroUI 3.2.4, Tailwind CSS 4, Electron renderer acceptance.

**Spec:** User screenshot and request on 2026-10-26; `docs/ui-guidelines.md`.

## Global constraints

- Main was clean at `990ef1d`; no active parallel development was established. Work directly in main per repository rules.
- Do not stop or take ownership of the existing development service.
- Keep Dashboard/Desktop shared imports and independent DashboardFilter copies consistent.
- Change only confirmed compact picker sizing; do not modify default settings controls or business behavior.

## Review focus

- Both 28px and 32px triggers must show a complete text line at wide and narrow widths.
- Agent selections with 18px icons must fit and remain centered.
- Autocomplete's overlaid button, selection, clear action and focus must remain usable.
- The 36px context-window picker must retain complete text on narrow screens.
- Long labels may truncate horizontally, without vertical clipping or page overflow.

## Task 1: Fix and verify the compact picker family

Files: `packages/dashboard/src/components/{SessionActivityPanel,SessionPagination,PricingTools,PricingMoreFilters,UsageTrendExplorer,ShareActivityModalContent,DashboardFilter}.tsx`, `packages/dashboard/src/pages/PricingPage.tsx`, `apps/desktop/src/renderer/components/DashboardFilter.tsx`, `apps/desktop/scripts/session-pagination-smoke.mjs`, `docs/ui-guidelines.md`, `.changeset/compact-picker-text.md`.

- [x] Reproduce the regression with a real renderer assertion. Before the fix the related model value has clientHeight 12, scrollHeight 20, lineHeight 20.
- [x] Confirm the Dashboard unit-test baseline (292 passing).
- [x] Add `!items-center !py-0` to affected fixed-height triggers and `!text-xs !leading-4` to their values; preserve all other classes and props (15 sites in 9 files).
- [x] Extend real renderer checks to the relevant compact controls, including narrow layouts and selection changes.
- [x] Update the existing UI sizing guidance and add a user-facing patch changeset.
- [x] Build both renderers; run Dashboard tests, Desktop typecheck and the HTTP/IPC session pagination acceptance.
- [x] Inspect screenshots and independently review the scoped diff; resolve actionable findings.
- [x] Commit only this task's reviewed changes and report verification boundaries.

## Verification notes

- Full `corepack pnpm test` stops in the unchanged npm-release first-publication smoke test: the registry cannot supply `quotern-core@0.1.9`. No release implementation or dependency files were changed for this task.
- `corepack pnpm build`, `corepack pnpm -r --if-present test`, and Desktop typecheck passed. Final Dashboard/Desktop builds and Dashboard tests passed again after the additional SessionBrowser entry points were corrected.
- Independent review found no actionable business-style regression. It identified a new smoke-test locator that assumed Popover.Trigger was a native button; the real DOM uses `div[role="button"]`. The locator now uses the component's data-slot, verified against the actual page.
- Expanded smoke coverage retains real Core read routes, with a no-op collection-range request for the isolated read-only fixture. New full-page navigations reapply static screenshot motion settings, and the combined acceptance deadline is 180 seconds.
- Final `corepack pnpm test:session-pagination-ui` passed all eight HTTP/IPC acceptance groups with a clean log. It covers default and long selected model values, a selected 18px Agent icon at 375px, provider selection/clearing/focus, and dashboard/share/pricing controls at 1120px and 375px. Read-only quota and empty legacy-background IPC responses keep the expanded isolated fixture complete.
- Actual Vite data also confirmed the original session's model trigger remains 28px while its value height, scroll height and line height are all 16px. The original-session crop and the built HTTP/IPC narrow screenshots were visually checked.
