# Mixed quota card layout follow-up

The user requested whole-card dragging in edit mode while retaining the grip icon, sorting the four status subscriptions as well, and a clearer editing entry. Work directly on main, retaining the existing draft/save/cancel and validation workflow.

## Decisions

- Use a pencil icon with the visible label “编辑布局”.
- Only edit mode enables card-body dragging; exclude buttons, links, inputs and menus. Keep the grip and keyboard/text movement alternatives. Touch dragging is also available over the edited card; normal browsing retains scrolling and details.
- Sort all visible subscription IDs together. Consecutive status-only entries share a compact group; moving one across an allowance splits/merges these visual groups without forcing an entry to the end.
- Status rows use vertical insertion within their group. The outer card grid continues to use its actual layout geometry.
- Preserve details, native notification routing, hidden IDs and draft recovery. Restore focus by provider ID after movement across groups.

## Steps

- [x] Add failing coverage for mixed group insertion and status ordering, plus whole-card pointer starts.
- [x] Update the shared pointer interaction and grouping, both UI consumers and the editing entry.
- [x] Update UI guidance and verify both ends, including native tray navigation.
- [x] Independently review and use the in-app browser to verify the requested interactions.

Close with a local atomic commit after the final diff check.

## Validation

- Dashboard and Desktop builds passed; Desktop typecheck passed.
- Dashboard suite: 315 tests passed. Localization catalog check: 1 test passed.
- Mixed UI fixture run `.quotern-dev/quota-layout-mixed-20261112-4`: browser and Desktop passed whole-card mouse/touch dragging, four status entries, vertical and cross-type insertion, grip clicks, keyboard, save/cancel/retry, hidden IDs and refreshed status-group detail retention.
- General dashboard regression: 12 groups passed in `.quotern-dev/quota-layout-mixed-dashboard-20261112`; Windows native tray/navigation regression passed in `.quotern-dev/quota-layout-mixed-tray-20261112`.
- Initial review found status-group reparenting could close an unchanged open detail and immediate outer pointer capture broke grip clicks. The detail regression failed before repair (mixed run 2); commit-time group identity and threshold-based capture fixed these. Touch implicit capture transfers are filtered by pointer ID and capture owner. Targeted independent review found no further blocking defect in those fixes.
- In-app browser: dragged Codex from its body, dragged Claude from its status text within the status group and ahead of quota cards, used Gemini CLI's text move menu, and cancelled the temporary order. Verified all six grips, retained compact display and the pencil/text entry. Screenshots retained outside the repository.
