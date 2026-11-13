---
"quotern-core": patch
"quotern-desktop": patch
---

Fix Desktop freezes during automatic session and quota-history refreshes, including long waits while opening settings or menus. Reuse unchanged session analyses, keep large history queries off the window process, and avoid periodic Windows process checks blocking user input. Preserve session details, account history, pricing updates and exports in Desktop and the CLI panel.
