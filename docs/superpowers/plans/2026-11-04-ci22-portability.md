# CI #22 portability repairs

Goal: fix the Windows esbuild binary lookup failure and the three macOS Helper startup tests from [CI #22](https://github.com/yuhengqin/Quotern/actions/runs/41804900065). Keep product UI, dependency versions, the lockfile and existing startup behavior.

Use the existing independent checkout because the main workspace has a running Desktop development service. Do not manually modify or prune shared package-store contents or stop that service.

- [x] Reproduce launcher startup and generation-error propagation through a directory alias, including preserved entry-point symlinks. Keep the original direct-path cases.
- [x] Compare real paths for the launcher entry point; retain inert imports and the UTF-8 output bridge.
- [x] Extend the existing fresh-dependency workflow policy to normal CI, observe its failure, then align CI with the Desktop release cache policy. Keep pnpm's local global virtual store enabled.
- [x] Run the focused tests, complete repository build/tests, Desktop type checking and the existing UI smoke on the final source state.
- [x] Independently review the changes; no review findings.

Delivery acceptance: commit and push only the verification branch, require a real Windows/macOS/Ubuntu CI pass on that commit before pushing it to main, then confirm the post-push main run and synchronize local main. Hosted results are recorded in Actions and the final handoff.

Local evidence: four launcher alias cases and the workflow policy failed before their fixes; all 19 focused checks passed after the fixes. With Node.js 22.23.4, `corepack pnpm test`, Desktop type checking, an actual esbuild transform and all 35 UI smoke groups passed.

Evidence limits: CI's Windows exception proves the esbuild package could not resolve either its optional platform package or fallback binary. A restored incomplete store graph is the strongest supported cause, rather than a directly inspected runner filesystem fact. A fresh hosted install and real esbuild-backed builds are the acceptance checks.
