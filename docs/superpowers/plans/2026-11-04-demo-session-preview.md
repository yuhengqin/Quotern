# Demo session preview and local snapshot update

> **For agentic workers:** Use superpowers:executing-plans for inline implementation; the primary agent owns code, deployment and acceptance.

**Goal:** Refresh volce from the Windows machine's persisted Quotern data and show only the first session page in demo mode, with a notice when Next is pressed.

**Architecture:** Use the existing HTML demo marker, shared session page and application Toast queue. Normalize demo pagination before requesting data and replace out-of-range URLs. Normal browser and Desktop pagination retain their existing behavior. Publish a new release directory and snapshot with a matching NGINX cache version; preserve rollback files.

**Tech stack:** React 19, HeroUI v3, TanStack Router, TypeScript, Quotern CLI, systemd, NGINX.

**Spec:** User request in this chat, 2026-11-04: use local data only; demo sessions show one page and Next displays a notice.

## Constraints and decisions

- Use the existing default of 12 top-level sessions; filters, details, counts and CSV export retain their behavior.
- Only validated demo metadata enables the limit. Hide page-size/jump controls and later page links in demo mode.
- Use the existing Toast queue with four-language copy; mouse and keyboard activation keep the current list and URL.
- Never change source data or the existing main-workspace Desktop process. Use this isolated worktree and a dedicated local demo port.
- Refresh snapshot and code together; change the NGINX cache key using the release commit and new snapshot SHA-256.

## Implementation and verification

- [x] Add focused tests for demo direct-link pagination normalization and preserved filters/normal mode; observe the expected failure, then implement.
- [x] Add demo-only pagination feedback and copy, update the existing UI/runtime documentation and changeset.
- [x] Run Dashboard tests, localization checks, Desktop typecheck and the CLI build; perform focused independent review.
- [x] Verify the built demo with the exported local snapshot: first-page URL, Next mouse/keyboard feedback, filters and normal-mode pagination.
- [ ] Upload a versioned code artifact and snapshot; validate candidate service before switching; back up unit, snapshot and NGINX configuration.
- [ ] Switch the service/cache version, verify public page/API/cache behavior, capture the result and record rollback paths.
