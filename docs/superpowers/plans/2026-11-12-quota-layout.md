# Quota layout implementation plan

> **For agentic workers:** Use superpowers:executing-plans. The user approved the interaction proposal and requested direct implementation on main, followed by in-app browser verification.

**Goal:** Arrange real quota cards in place with a title drag handle, an explicit drop indicator and text movement actions.

**Architecture:** Share the editor, draft order and pointer interaction between Dashboard and Desktop. Preserve existing quota cards, details, status grouping and HTTP/IPC persistence. Use existing React/HeroUI and Pointer Events; no additional dependencies.

**Spec:** Approved proposal in this chat: enter arrangement mode from “额度排列”, use title handles, show the destination, retain move up/down/to first actions, remove the star action. Retain compact cards.

## Global constraints

- Work directly on clean main; do not restart or stop the pre-existing development service.
- Browsing retains the existing details and status interactions. Arrangement mode prevents accidental detail opening.
- Moves and compact changes preview locally; Done saves them together. Cancel discards them. Failed saves retain the draft and offer retry.
- Keep pure status subscriptions grouped last; explain that boundary only while arranging.
- Keep hidden provider IDs in saved order; reconcile current provider data without overwriting an edit draft.
- Use real DOM order, focus recovery, polite movement announcements, a non-drag alternative and scoped touch handling.

## Review focus

- Horizontal and wrapped grids, one-column cards and unequal card heights must resolve sensible before/after positions.
- Drag cancellation, second pointers and page scrolling must not commit a move or open details.
- A background quota refresh must not discard local edits or provider IDs not currently displayed.
- Save failure must preserve the preview, current controls and recoverability.
- Desktop notification navigation and tray summary must continue working.

## Tasks

- [x] Add failing behavior tests for order changes, hidden IDs and grid drop geometry in `packages/dashboard/src/lib/quota-layout.test.ts`.
- [x] Implement the shared order helpers and editor in `lib/quota-layout.ts` and `components/QuotaLayoutControl.tsx`; verify focused tests.
- [x] Integrate title controls and edit guards in shared `QuotaUsageCard.tsx` and both `SubscriptionUsageGrid.tsx` files; keep Desktop summary/navigation behavior.
- [x] Extend the existing synthetic island UI harness with focused dual-end layout scenarios, including failure, cancellation, real pointer movement, keyboard actions and narrow viewport.
- [x] Update `docs/ui-guidelines.md`, run applicable tests/builds and independent review, then verify the running page in the in-app browser.

Close out with one local atomic commit on main after inspecting the final diff.

## Verification record

- Dashboard and Desktop production builds passed; Desktop typecheck passed.
- Dashboard unit suite: 313 passed; localization catalog check: 1 passed.
- `test:island-ux-ui .quotern-dev/quota-layout-20261112-7 --quota-layout-only`: both browser and Desktop passed, including pointer/touch, keyboard, failure retry and hidden-account restoration.
- `test:dashboard-ui .quotern-dev/quota-layout-dashboard-20261112`: 12 groups passed.
- `test:island-ux-ui .quotern-dev/quota-layout-tray-20261112 --tray-only`: Windows native tray/navigation regression passed.
- Independent review identified a draft-position loss when a moved account disappeared during editing. Reproduced with the new UI regression (run 6), then fixed by saving the complete draft and retaining newly saved invisible IDs (run 7 passed).
- In-app browser at the existing main service on port 5195: real card drag, visible insertion line, Escape, text movement menu, cancel, compact preview, saved order after reload, and normal details after editing verified. Original Codex/Cursor order and compact preference restored.
- Browser and Desktop synthetic screenshots inspected. Full repository suite and macOS/Linux were outside this UI validation scope.
