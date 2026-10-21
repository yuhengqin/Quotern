# Quotern integration

The generated `runtime/controls.js` is a Quotern-owned backport of the playback receipt, occupancy lock and motion contracts from upstream `cf3ed3c4dd6829b252f352d4c61a18db6fdb26d4` (`src/host/playback.ts`, `lock.ts`, `motion-cue.ts`, `runtime/electron-helper/sprite.js` and `events.js`). It loads after the audited sprite/events and before boot. The host adaptation lives in `src/main/dsh-pet/controls.ts`; it bounds record/wait counts, cancels outstanding records on shutdown and retains the authenticated named pipe. Remote animation URLs and the upstream standalone HTTP server are not imported. The original snapshot and its manifest remain unchanged.

Source snapshot: https://github.com/PC2005-cloud/dsh-pet at `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f` (`0.3.7`). `UPSTREAM.json` records every vendored file and its SHA-256 digest; all entries match the upstream snapshot except the three files carrying the default pet rename below.

Code: MIT, see LICENSE. Upstream media/prompts/source videos permit open-source use and prohibit commercial use. Derived introductions, displays and distribution must credit https://github.com/PC2005-cloud/dsh-pet (see UPSTREAM_README.md).

The preparation script builds only the checked-in snapshot and copies only manifest-owned runtime resources. GIF documentation previews, source videos and the separately unverified bundled font are not distributed. Runtime defaults use the system font and desktop display mode; the original configuration remains available in the snapshot.

The desktop companion's transport and host integration are maintained in Quotern's own source; any build-time adaptations are applied to the output, preserving the original snapshot for comparison.

The default pet is renamed from `蓝毛小女仆` to `大肥鱼` directly in the snapshot's `assets/config.jsonc` and the two host fixtures `src/host/anim.test.ts` and `src/host/broadcast.test.ts`, so the shipped default matches Quotern's role name. These three files are the only snapshot content that differs from upstream, and their `UPSTREAM.json` digests cover the renamed copies. Every other snapshot file must stay byte-identical to upstream.

The generated host bundle replaces the regular-expression JSONC comment stripper with Quotern's string-aware scanner. URLs and prompt literals containing `//` or `/* */` must survive advanced configuration edits unchanged.

The generated shared balance renderer accepts an optional `monthlyLabel`. Quotern uses the legacy mandatory numeric slot for one actual selected quota window and supplies its real label and reset time; this does not create fictitious monthly/weekly/5h windows or infer monetary allowances.

The generated helper replaces the stdout/HTTP callback bridge with an authenticated duplex named-pipe client, waits for connection before creating windows, and exits on pipe disconnection. Its media response streams valid byte ranges. The DPI probe re-enters Quotern's early helper bootstrap; helper pages use absolute paths. The menu opens Quotern through the private host action. These transformations are guarded against unexpected upstream source changes. The animation, physics, scoring and collision algorithms stay upstream.

The existing opt-in `DSH_PET_SMOKE` self-test is also corrected at build time: it establishes a clean menu/chat/drag input state, supplies `buttons:1` for held-drag movement, captures position immediately before release, and closes the tested menu before checking the direct input bridge. These are test preconditions, not changes to normal pointer behavior.

The generated shared chat dialog ignores composition-confirmation Enter events, reclamps after text/error/viewport size changes, and scrolls long input within the visible work area. The raw shared/chat.ts snapshot remains unchanged. The Quotern host clears a completed model conversation's own activity instead of publishing a generic completion bubble over its actual reply; independent Agent terminal events retain their original priority.

On Windows, the generated helper disables Electron mouse forwarding, which otherwise installs a process-wide WH_MOUSE_LL hook on the helper's UI thread. Existing pointer hit-testing instead runs at 16ms intervals. A deduplicated local cursor sample maintains hover and clears it on exit or after input capture ends; distant movement generates no continuing renderer IPC. Drag/menu/chat input retains its existing capture and region rules. Other platforms keep the upstream forwarding and 60ms interval. The raw main/preload/sprite snapshots remain unchanged.

The generated desktop sprite backports [d893303](https://github.com/PC2005-cloud/dsh-pet/commit/d893303d021ba6108e32631ee81a0944bf8d6996) and [97f1396](https://github.com/PC2005-cloud/dsh-pet/commit/97f13966e2a2f8aa43462f630a61c7b97a89ffe7): `confineToScreen` also constrains wandering to the current (or nearest) screen, and walking direction follows the already-updated facing without another turn inversion. `patch-dsh-pet-motion.mjs` guards these output-only replacements; the snapshot hashes and all other patches remain intact.

Quotern's existing main-process tray hosts a single independent-pet checkbox, inspired by upstream [091b27b](https://github.com/PC2005-cloud/dsh-pet/commit/091b27b40f9eeecc814bedb691fe214ec2b48299). Turning it off stops the helper and background work; turning it on restores the selected pet through the controller's serialized lifecycle, preserving its web display bit. No additional helper tray or upstream standalone service is installed.

The Quotern configuration store projects legacy configuration onto one selected instance for every runtime consumer (helper, model scheduling and manual actions), disables inter-pet collision in that projection, and persists the selected ID in preferences. Selection initially prefers the first desktop-visible pet, otherwise the first configured pet. Other instances' raw configuration and memory remain on disk; settings expose only the selected pet and omit multi-instance controls. The audited upstream snapshot retains its original multi-pet implementation unchanged.
