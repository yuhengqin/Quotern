# Complete HTML reports

Use this mode when the user asks for a report, weekly/monthly review, HTML/export, a result to keep or share, or a substantial analysis with more detail than a short chat answer can carry. Respect explicit brief or chat-only requests. The report is a local, self-contained snapshot; sharing a file does not require publishing it or starting a service.

## Input and workflow

1. Select the existing `quotern usage` query matching the question and save its JSON as UTF-8. Full and compact `schemaVersion: 1` reports are supported, including summary, models, projects, daily, weekly and monthly. One report file represents one query and its scope; do not combine different dates, filters or snapshots into an invented total.
2. Read the returned summary, rows and coverage before drafting findings. Keep Core's totals and source/model identities. For a time report, missing dates are missing records rather than measured zeroes. For price-match explanations, query full JSON and explain the evidence in notes; the renderer does not calculate prices.
3. Write an optional analysis JSON object with a short title, an interpretation-led overview and supported findings. Use plain text, not HTML or Markdown. Figures come from this query; compute ratios with code. Include next steps only when the user question and evidence support them.
4. Render with the bundled script. Choose the user's requested output directory, otherwise a task-local output directory. Resolve `SKILL_DIR` below to the actual installed skill directory. Use an absolute output path in the final handoff.

```sh
quotern usage models --days 7 --format json --compact > usage.json
node "SKILL_DIR/scripts/render-report.mjs" --input usage.json --analysis analysis.json --output usage-report.html
```

On Windows PowerShell, save CLI output explicitly as UTF-8:

```powershell
quotern usage models --days 7 --format json --compact | Set-Content -Encoding utf8 usage.json
node "SKILL_DIR/scripts/render-report.mjs" --input usage.json --analysis analysis.json --output usage-report.html
```

The script uses only Node.js built-ins and resolves its template relative to itself. No install, build, network, server or browser dependency is required to generate the file. Its layout is Chinese by default. The output file must be new; `--force` replaces an existing report only when that path is an artifact owned by this task. Keep input JSON files intact. Add `--costs` only when the user requested costs; otherwise fees stay out of the report. `--analysis` is optional for a data-only export, but an analytical report should provide an overview and supported findings.

Analysis JSON fields (all optional):

```json
{
  "title": "最近 7 天模型用量报告",
  "overview": "用量集中在少数模型；总量中的缓存读取需要单独理解。",
  "findings": [
    { "title": "这里写有数据支持的发现", "detail": "写明具体数值、比较依据及其含义；不要复制本示意文本。" }
  ],
  "notes": [],
  "nextSteps": []
}
```

## Fixed reading order

- **Overview:** requested dates, time zone, active filters and authoritative totals. Coverage gaps and incomplete prices qualify the headline visibly.
- **Findings:** an interpretation-led overview and a few findings with supporting values. Explain relationships instead of repeating the metric cards. This text is the Agent's contribution; keep claims inside the available evidence.
- **Visual evidence:** sorted horizontal bars for model/project rankings, or date-positioned bars for recorded time buckets. Rankings show at most ten chart bars, explicitly labeled when truncated. Time gaps remain gaps.
- **Complete detail:** every returned row, preserving source/model identity, with exact Token values and shares calculated from the same report total. The table can be collapsed; chart truncation never removes table rows.
- **Composition and scope:** Token components, successful-sync/read timestamps, snapshot meaning and relevant limitations. Fees, reported/estimated amounts and missing/default prices appear only with `--costs`.

The HTML is offline and script-free, supports system light/dark appearance and uses native expandable sections. The renderer owns layout and safe text escaping; do not rewrite the template per query or add decorative controls without behavior. Annotations are plain text so they cannot change the page structure.

## Verification and handoff

Run the renderer and confirm its JSON receipt identifies the intended output file, row count, period and dates. Open the HTML with available browser/file-preview tools and check headline scope, amounts, all detail rows, expanded/collapsed sections, readable tables at narrow widths and system appearance. When browser preview is unavailable, inspect the saved output and report that visual verification was not performed. Generation alone is not proof of browser behavior.

Finish with a short chat answer: the main result, a useful finding, any limitation that materially changes it, and a descriptive link to the complete HTML report. The file carries full tables and methodology; chat does not repeat them. A suitable handoff shape is:

> 已生成最近 7 天的模型用量报告。这里用本次数据说明主要发现；有采集缺口或费用不完整时紧接着说明。[打开完整报告](absolute-output-path)

Replace this illustrative wording and path with the actual findings and saved file. If generation fails, state the concrete failure and provide the verified inline result; do not claim that a report exists.
