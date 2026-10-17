# Complete HTML reports

Use this mode by default for broad usage requests such as “查看用量信息”, or when the user asks for a report, weekly/monthly review, HTML/export, a result to keep or share, or substantial analysis. Respect explicit brief or chat-only requests. The report is a local, self-contained snapshot; sharing a file does not require publishing it or starting a service.

## Input and workflow

1. Select the `quotern usage` query matching the question and save its JSON as UTF-8. Broad requests use `overview`. Full and compact `schemaVersion: 1` reports are supported for overview, summary, models, projects, daily, weekly and monthly. One report file represents one query and its scope; do not combine different dates, filters or snapshots into an invented total.
2. Read the returned summary, rows, coverage and (for overview) all three `breakdowns` before drafting findings. Overview's daily/model/project dimensions come from the same selected records and share the top-level range, filters and coverage. Never sum dimensions together. Keep Core's totals and source/model identities. Missing dates are missing records rather than measured zeroes. For price-match explanations, query full JSON and explain the evidence in notes; the renderer does not calculate prices.
3. Write an optional analysis JSON object with a short title, an interpretation-led overview and supported findings. Use plain text, not HTML or Markdown. Figures come from this query; compute ratios with code. Include next steps only when the user question and evidence support them.
4. Render with the bundled script. Choose the user's requested output directory, otherwise a task-local output directory. Resolve `SKILL_DIR` below to the actual installed skill directory. Use an absolute output path in the final handoff.

```sh
quotern usage overview --days 7 --format json --compact > usage.json
node "SKILL_DIR/scripts/render-report.mjs" --input usage.json --analysis analysis.json --output usage-report.html
```

On Windows PowerShell, save CLI output explicitly as UTF-8:

```powershell
quotern usage overview --days 7 --format json --compact | Set-Content -Encoding utf8 usage.json
node "SKILL_DIR/scripts/render-report.mjs" --input usage.json --analysis analysis.json --output usage-report.html
```

The script uses only Node.js built-ins and resolves its template relative to itself. No install, build, network, server or browser dependency is required to generate the file. Its layout is Chinese by default. The output file must be new; `--force` replaces an existing report only when that path is an artifact owned by this task. Keep input JSON files intact. Add `--costs` only when the user requested costs; otherwise fees stay out of the report. `--analysis` is optional for a data-only export, but an analytical report should provide an overview and supported findings.

Analysis JSON fields (all optional):

```json
{
  "title": "最近 7 天综合用量概览",
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
- **Visual evidence:** overview shows Token composition, the daily trend, then model and project rankings side by side on wide screens. Its compact rankings show five chart bars; focused ranking reports show ten. Truncation is labeled and time gaps remain gaps.
- **Complete detail:** every returned row, preserving source/model identity, with exact Token values and shares calculated from the same report total. Overview has separate expandable daily/model/project tables. Chart truncation never removes table rows.
- **Composition and scope:** Token components, successful-sync/read timestamps, snapshot meaning and relevant limitations. Fees, reported/estimated amounts and missing/default prices appear only with `--costs`.

The HTML is offline and script-free, supports system light/dark appearance and uses native expandable sections. Its bundled typography, Q mark, neutral card surfaces and Agent chart colors follow the Quotern Dashboard; the JetBrains Mono font and its license are embedded so sharing the single HTML file preserves the Latin typography without external requests. Chinese text uses the same system fallback stack as Dashboard. The renderer owns layout and safe text escaping; do not rewrite the template per query or add decorative controls without behavior. Annotations are plain text so they cannot change the page structure.

## Verification and handoff

Run the renderer and confirm its JSON receipt identifies the intended output file, row count, period and dates. Open the HTML with available browser/file-preview tools and check headline scope, amounts, all detail rows, expanded/collapsed sections, readable tables at narrow widths and system appearance. When browser preview is unavailable, inspect the saved output and report that visual verification was not performed. Generation alone is not proof of browser behavior.

Finish with a short chat answer: the main result, a useful finding, any limitation that materially changes it, and a descriptive link to the complete HTML report. The file carries full tables and methodology; chat does not repeat them. A suitable handoff shape is:

> 已生成最近 7 天的综合用量概览，包含趋势、模型和项目分布。这里用本次数据说明主要发现；有采集缺口时紧接着说明。[打开完整报告](absolute-output-path)

Replace this illustrative wording and path with the actual findings and saved file. If generation fails, state the concrete failure and provide the verified inline result; do not claim that a report exists.
