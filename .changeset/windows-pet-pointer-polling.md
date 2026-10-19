---
"quotern-desktop": patch
---

Remove the independent pet's global Windows mouse-forwarding hook to avoid desktop-wide input stalls when the helper is busy. Use bounded cursor polling while preserving hover, click-through, dragging, menus and chat input.
