# Account launch and platform billing

Implement the three selected gaps from the Claude-Usage-Tracker comparison. Quota-history export is excluded. Existing monitoring, reports, session actions and estimates remain available.

## Decisions and boundaries

- The user selected **Quotern-managed default accounts**: `quotern launch claude` resolves the chosen configuration directory. Automatic switching changes that default for subsequent launches; existing sessions retain their identity. Do not copy OAuth credentials, modify the original `claude` executable, or edit shell profiles.
- Reuse monitored Claude/Codex profiles for explicit terminal launch. Bind `CLAUDE_CONFIG_DIR` / `CODEX_HOME` in the child terminal on Windows, macOS and Linux; handle spaces and shell characters as literal data. No network/model request is needed to launch. CLI invocation uses the current project; the UI opens a terminal in the user's home directory unless a working directory is supplied.
- Default selection and automatic switching use an atomic, revision-checked local preference. Removed or retargeted profiles invalidate a pinned selection instead of silently launching another account.
- Automatic Claude switching is off by default. Only the running quota owner may act, using fresh, verified native readings, known exhausted shared quota and an eligible different account from `recommendQuota`. No OMP-only, unknown or stale candidates. Recheck the current selection and live settings before commit; persist the reason and time for display. Isolated development does not run automatic switching.
- Claude.ai Extra Usage and Anthropic Console are separately configured connections. Read-only GET requests use fixed upstream origins, bounded responses/timeouts and no redirects. Preserve zero, unknown, partial and stale states. The default-workspace detail total is distinct from organization-wide current spend.
- Credentials are entered locally, never returned by GET, logged, exported, embedded in scripts or included in backups. Windows persists user-bound DPAPI ciphertext; POSIX uses a private directory and owner-only files. The UI can replace or remove a connection and discover organizations before saving. No automatic browser-cookie extraction.
- Shared UI uses existing HeroUI controls, formatUsd, i18n and HTTP/IPC transport. Dashboard and Desktop both expose account actions and billing. Details and configuration are on demand; failures and unknown monetary values remain visible.

## Approaches considered

Copying default CLI credentials matches the reference but allows two directories to compete for rotating OAuth tokens and has no atomic cross-store rollback. Managed launch selection was recommended and explicitly chosen by the user. Billing follows the reference's read-only web-session APIs because these expose Extra Usage and prepaid balances; their undocumented nature is surfaced in connection help and errors, with no challenge bypass or fabricated fallback data.

## Verification

Use synthetic credentials and responses for tests. Exercise terminal environment/quoting on Windows, cross-platform command construction, selection revision conflicts and removed profiles, autoswitch eligibility/ownership/races, amount conversion and partial responses, source isolation, credential non-disclosure and loopback mutation authorization. Build both UIs, run repository checks, then inspect actual rendered account and billing flows with controlled fixtures. Real-account reads and macOS/Linux native terminals require separate environment validation.
