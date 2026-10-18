# Quotern integration

Source snapshot: https://github.com/PC2005-cloud/dsh-pet at `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f` (`0.3.7`). `UPSTREAM.json` records unchanged upstream files and their SHA-256 digests.

Code: MIT, see LICENSE. Upstream media/prompts/source videos permit open-source use and prohibit commercial use. Derived introductions, displays and distribution must credit https://github.com/PC2005-cloud/dsh-pet (see UPSTREAM_README.md).

The preparation script builds only the checked-in snapshot and copies only manifest-owned runtime resources. GIF documentation previews, source videos and the separately unverified bundled font are not distributed. Runtime defaults use the system font and desktop display mode; the original configuration remains available in the snapshot.

The desktop companion's transport and host integration are maintained in Quotern's own source; any build-time adaptations are applied to the output, preserving the original snapshot for comparison.

The generated host bundle replaces the regular-expression JSONC comment stripper with Quotern's string-aware scanner. URLs and prompt literals containing `//` or `/* */` must survive advanced configuration edits unchanged.

The generated shared balance renderer accepts an optional `monthlyLabel`. Quotern uses the legacy mandatory numeric slot for one actual selected quota window and supplies its real label and reset time; this does not create fictitious monthly/weekly/5h windows or infer monetary allowances.
