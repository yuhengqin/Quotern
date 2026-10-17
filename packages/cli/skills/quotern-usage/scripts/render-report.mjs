import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const templateUrl = new URL('../assets/report-template.html', import.meta.url);
const periodNames = { summary: '用量总览', models: '模型用量', projects: '项目用量', daily: '每日用量', weekly: '每周用量', monthly: '每月用量' };
const sourceNames = { codex: 'Codex', claude: 'Claude', zcode: 'Zcode', opencode: 'OpenCode', antigravity: 'Antigravity', cursor: 'Cursor', gemini: 'Gemini' };
const countNames = { summary: '汇总项', models: '模型与来源组合', projects: '项目', daily: '有记录的日期', weekly: '有记录的周', monthly: '有记录的月份' };
const whole = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const sourceName = (source) => Object.hasOwn(sourceNames, source) ? sourceNames[source] : source ?? '—';
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const exact = (value) => validNumber(value) ? whole.format(value) : '未记录';

function compact(value) {
  if (!validNumber(value)) return '未记录';
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  return exact(value);
}

function percent(value, total) {
  if (!validNumber(value) || !validNumber(total) || total === 0) return '—';
  const result = value / total * 100;
  return result > 0 && result < 0.01 ? '<0.01%' : `${result.toFixed(2)}%`;
}

function dollars(value) {
  if (!validNumber(value)) return '未知';
  return value > 0 && value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;
}

function dateLabel(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function timeLabel(report, field) {
  const raw = report.coverage[field];
  // Parse only timezone-bearing instants. A display timestamp is already local.
  if (typeof raw === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw))) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: report.timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', numberingSystem: 'latn',
    }).formatToParts(new Date(raw));
    const part = (type) => parts.find((entry) => entry.type === type)?.value;
    return `${part('year')}年${part('month')}月${part('day')}日 ${part('hour')}:${part('minute')}`;
  }
  return report.coverage.display?.[field] ?? '未记录';
}

function validate(report, analysis) {
  if (report?.schemaVersion !== 1) throw new Error('Unsupported schemaVersion; expected 1.');
  if (!Object.hasOwn(periodNames, report.period)) throw new Error('Unsupported report period.');
  if (!report.coverage || typeof report.coverage.limited !== 'boolean' || !['persisted', 'runtime'].includes(report.coverage.snapshot)) throw new Error('Missing or invalid coverage.');
  if (!report.filters || !Array.isArray(report.filters.sources)) throw new Error('Missing filters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(report.toDate) || report.fromDate > report.toDate) throw new Error('Invalid report dates.');
  if (typeof report.timeZone !== 'string' || !report.timeZone) throw new Error('Missing timeZone.');
  new Intl.DateTimeFormat('zh-CN', { timeZone: report.timeZone }).format();
  if (!validNumber(report.summary?.tokens) || !Array.isArray(report.rows)) throw new Error('Invalid summary.tokens or rows.');
  for (const [index, row] of report.rows.entries()) {
    if (!validNumber(row?.tokens) || typeof row.label !== 'string') throw new Error(`Invalid rows[${index}].tokens or label.`);
    for (const key of ['costUsd', 'knownCostUsd']) {
      if (row[key] != null && !validNumber(row[key])) throw new Error(`Invalid rows[${index}].${key}.`);
    }
  }
  for (const key of ['costUsd', 'knownCostUsd', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (report.summary[key] != null && !validNumber(report.summary[key])) throw new Error(`Invalid summary.${key}.`);
  }
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) throw new Error('Analysis must be an object.');
  for (const key of ['title', 'overview']) {
    if (analysis[key] != null && typeof analysis[key] !== 'string') throw new Error(`Analysis ${key} must be text.`);
  }
  for (const key of ['findings', 'notes', 'nextSteps']) {
    if (analysis[key] != null && !Array.isArray(analysis[key])) throw new Error(`Analysis ${key} must be an array.`);
  }
  for (const finding of analysis.findings ?? []) {
    if (typeof finding?.title !== 'string' || typeof finding?.detail !== 'string') throw new Error('Each finding needs title and detail text.');
  }
  for (const value of [...(analysis.notes ?? []), ...(analysis.nextSteps ?? [])]) {
    if (typeof value !== 'string') throw new Error('Analysis notes and nextSteps must contain text.');
  }
}

function metric(label, value, note) {
  return `<div class="metric"><p class="eyebrow">${escape(label)}</p><p class="metric-value">${escape(value)}</p><p class="muted">${escape(note)}</p></div>`;
}

function scopeText(report) {
  const parts = [report.filters.sources.length ? `来源：${report.filters.sources.map(sourceName).join('、')}` : '全部来源'];
  if (report.filters.model) parts.push(`模型：${report.filters.model}`);
  if (report.filters.project) parts.push(`项目：${report.filters.project}`);
  return parts.join(' · ');
}

function costLabel(summary) {
  const explanation = summary.costExplanation;
  if (explanation?.reportedCostUsd > 0 && explanation?.estimatedCostUsd > 0) return '来源报告与估算费用';
  if (explanation?.estimatedCostUsd > 0) return '估算费用';
  if (explanation?.reportedCostUsd > 0) return '来源报告费用';
  return '费用合计';
}

function warnings(report, costs) {
  const result = [];
  if (report.coverage.limited) result.push(`覆盖不完整：本地从 ${timeLabel(report, 'collectSince')} 开始采集，当前结果不能代表请求范围内的完整用量。`);
  if (costs && report.summary.costUsd == null) result.push(`完整费用未知：已定价部分为 ${dollars(report.summary.knownCostUsd)}；另有 ${compact(report.summary.costExplanation?.unpricedTokens)} Token 缺少价格，缺价不等于免费。`);
  if (costs && report.summary.costExplanation?.defaultPricedTokens > 0) result.push(`${compact(report.summary.costExplanation.defaultPricedTokens)} Token 使用默认价格估算，金额可能与实际计价有差异。`);
  if (report.coverage.invalidRows > 0) result.push(`统计中排除了 ${exact(report.coverage.invalidRows)} 条无效记录，结果可能不完整。`);
  return result.map((text) => `<p class="notice">${escape(text)}</p>`).join('');
}

function rankingChart(report, rows) {
  const shown = rows.slice(0, 10);
  const max = Math.max(...shown.map((row) => row.tokens), 0);
  if (!max) return '<p class="empty">暂无非零用量可供比较。</p>';
  const bars = shown.map((row) => `<li><div class="bar-label"><span>${escape(row.label)}${row.source ? `<small>${escape(sourceName(row.source))}</small>` : ''}</span><strong>${escape(compact(row.tokens))}</strong></div><div class="bar-track"><span style="inline-size:${row.tokens / max * 100}%"></span></div></li>`).join('');
  return `<p class="muted">${rows.length > 10 ? '图中显示用量前 10 项，完整明细保留全部项目。' : '按 Token 用量排序。'} 条形长度相对本图最大值；明细占比以当前筛选范围的总量为分母。</p><ol class="bars">${bars}</ol>`;
}

function temporalChart(report, rows) {
  const dated = rows.map((row) => ({ row, stamp: Date.parse(`${row.fromDate ?? (row.label.length === 7 ? `${row.label}-01` : row.label)}T00:00:00Z`) }));
  if (dated.some(({ stamp }) => !Number.isFinite(stamp))) return '<p class="muted">时间标签无法确定，完整数值见下方明细。</p>';
  const start = Date.parse(`${report.fromDate}T00:00:00Z`);
  const end = Date.parse(`${report.toDate}T00:00:00Z`);
  const span = Math.max(end - start, 86400000);
  const max = Math.max(...rows.map((row) => row.tokens), 0);
  if (!max) return '<p class="empty">暂无非零用量可供比较。</p>';
  const width = Math.min(24, 600 / Math.max(1, (end - start) / 86400000 + 1));
  const bars = dated.map(({ row, stamp }) => {
    const x = 55 + (stamp - start) / span * 600;
    const height = row.tokens / max * 170;
    return `<rect x="${x - width / 2}" y="${200 - height}" width="${width}" height="${height}" rx="2"><title>${escape(row.label)}：${escape(exact(row.tokens))} Token</title></rect>`;
  }).join('');
  return `<p class="muted">按时间展示各已记录时段；空白日期表示没有返回记录，不能据此确认零用量。</p><svg class="timeline" viewBox="0 0 710 245" role="img" aria-labelledby="timeline-title timeline-description"><title id="timeline-title">${escape(periodNames[report.period])}</title><desc id="timeline-description">当前筛选范围内已记录时段的 Token 用量。每个时段的精确值见完整明细。</desc><line x1="55" y1="200" x2="655" y2="200"/><text x="8" y="30">${escape(compact(max))}</text><text x="28" y="204">0</text>${bars}<text x="55" y="230">${escape(report.fromDate)}</text><text x="655" y="230" text-anchor="end">${escape(report.toDate)}</text></svg>`;
}

function table(report, rows, costs) {
  const timeSeries = ['daily', 'weekly', 'monthly'].includes(report.period);
  const headers = ['项目', '来源', ...(timeSeries ? ['实际统计范围'] : []), 'Token（精确值）', '占总量', ...(costs ? ['费用（USD）'] : [])];
  const head = headers.map((value) => `<th scope="col">${escape(value)}</th>`).join('');
  const body = rows.map((row) => `<tr><th scope="row">${escape(row.label)}</th><td>${escape(row.source ? sourceName(row.source) : '—')}</td>${timeSeries ? `<td>${escape(row.fromDate ?? row.label)} — ${escape(row.toDate ?? row.label)}</td>` : ''}<td class="number">${escape(exact(row.tokens))}</td><td class="number">${escape(percent(row.tokens, report.summary.tokens))}</td>${costs ? `<td class="number">${escape(row.costUsd == null ? `总额未知 · 已定价 ${dollars(row.knownCostUsd)}` : dollars(row.costUsd))}</td>` : ''}</tr>`).join('');
  return `<div class="table-wrapper" tabindex="0" role="region" aria-label="完整用量明细，可横向滚动"><table><caption>当前范围的全部 ${rows.length} 项；占比按未舍入数值计算。</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function composition(report) {
  const labels = [['inputTokens', '输入（非缓存）'], ['cacheReadTokens', '缓存读取'], ['cacheWriteTokens', '缓存写入'], ['outputTokens', '输出'], ['reasoningTokens', '推理']];
  const cells = labels.map(([key, label]) => `<div><dt>${escape(label)}</dt><dd>${escape(compact(report.summary[key]))}</dd><small>${escape(percent(report.summary[key], report.summary.tokens))}</small></div>`).join('');
  return `<dl class="composition">${cells}</dl><p class="muted">这里展示 Token 的组成；缓存读取占总量的比例不等于缓存命中率。各组成项直接采用报告返回值。</p>`;
}

function notes(report, analysis, costs) {
  const items = [
    report.coverage.snapshot === 'persisted' ? '本报告来自本地已保存的数据快照。' : '本报告来自内存数据快照。',
    `最近成功同步：${timeLabel(report, 'lastSyncAt')}；各来源可能仍有更新延迟。`,
    `报告数据读取：${timeLabel(report, 'readAt')}。读取或同步时间都不能证明每个来源已完整更新到该时刻。`,
    'Token 反映记录的使用量，不能单独据此判断产出、效率或实际支付金额。',
    ...(report.period === 'projects' ? ['项目按显示名称归组，不同目录的同名项目可能合并。'] : []),
    ...(costs ? [`费用中的来源报告金额：${dollars(report.summary.costExplanation?.reportedCostUsd)}；按费率估算：${dollars(report.summary.costExplanation?.estimatedCostUsd)}。二者均不代表实际支付证明。`] : []),
    ...(analysis.notes ?? []),
  ];
  return `<ul class="notes">${items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;
}

/** Presentation only: consume Core/CLI totals; never regroup or reprice them. */
export function renderUsageHtml(report, analysis = {}, options = {}) {
  validate(report, analysis);
  const costs = options.costs === true;
  const rows = [...report.rows].sort(['models', 'projects'].includes(report.period)
    ? (a, b) => b.tokens - a.tokens
    : (a, b) => (a.fromDate ?? a.label).localeCompare(b.fromDate ?? b.label));
  const summary = report.summary;
  const hitRate = summary.localMetrics?.cacheHitRate;
  const cacheNote = validNumber(hitRate) && hitRate <= 1 ? `缓存命中率 ${percent(hitRate, 1)}（报告记录）` : '缓存命中率未记录';
  const cards = metric('Token 合计', compact(summary.tokens), `精确值 ${exact(summary.tokens)}`)
    + metric('缓存读取占总量', percent(summary.cacheReadTokens, summary.tokens), cacheNote)
    + (costs
      ? metric(costLabel(summary), summary.costUsd == null ? '完整费用未知' : dollars(summary.costUsd), `已定价部分 ${dollars(summary.knownCostUsd)}`)
      : metric(countNames[report.period], exact(rows.length), '完整明细保留全部返回项目'));
  const findings = analysis.findings?.length
    ? `<section class="section" aria-labelledby="findings-title"><div class="section-heading"><span class="section-number">01</span><h2 id="findings-title">主要发现</h2></div><div class="findings">${analysis.findings.map((finding) => `<article><h3>${escape(finding.title)}</h3><p>${escape(finding.detail)}</p></article>`).join('')}</div></section>` : '';
  const chart = !rows.length ? '<p class="empty">暂无已采集记录。记录为空不能证明采集范围之外没有使用。</p>'
    : ['daily', 'weekly', 'monthly'].includes(report.period) ? temporalChart(report, rows)
      : report.period === 'summary' ? composition(report) : rankingChart(report, rows);
  const nextSteps = analysis.nextSteps?.length
    ? `<section class="section"><h2>可考虑的下一步</h2><ul class="notes">${analysis.nextSteps.map((text) => `<li>${escape(text)}</li>`).join('')}</ul></section>` : '';
  const values = {
    TITLE: escape(analysis.title || `${periodNames[report.period]}报告`),
    PERIOD: escape(periodNames[report.period]),
    RANGE: escape(`${dateLabel(report.fromDate)} — ${dateLabel(report.toDate)}`),
    ZONE: escape(report.timeZone === 'Asia/Shanghai' ? '北京时间' : report.timeZone),
    SCOPE: escape(scopeText(report)),
    OVERVIEW: analysis.overview ? `<p class="overview">${escape(analysis.overview)}</p>` : '',
    WARNINGS: warnings(report, costs), METRICS: cards, FINDINGS: findings, CHART: chart,
    DETAIL: rows.length ? table(report, rows, costs) : '<p class="empty">暂无已采集记录。</p>',
    COUNT: escape(rows.length), COMPOSITION: report.period === 'summary' ? '' : `<details class="section"><summary>Token 构成</summary>${composition(report)}</details>`,
    NOTES: notes(report, analysis, costs), NEXT_STEPS: nextSteps,
    ATTRIBUTION: analysis.overview || analysis.findings?.length || analysis.notes?.length || analysis.nextSteps?.length
      ? '<span>数值来自 Quotern · 文字解读由 AI 生成</span>' : '',
  };
  return readFileSync(templateUrl, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key] ?? '');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function sameFile(first, second) {
  if (resolve(first) === resolve(second)) return true;
  try {
    if (realpathSync(first) === realpathSync(second)) return true;
    const left = statSync(first, { bigint: true });
    const right = statSync(second, { bigint: true });
    return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['--costs', '--force'].includes(argument)) options[argument.slice(2)] = true;
    else if (['--input', '--output', '--analysis'].includes(argument) && args[index + 1] && !args[index + 1].startsWith('--')) options[argument.slice(2)] = resolve(args[++index]);
    else if (argument === '--help') {
      console.log('Usage: node render-report.mjs --input usage.json --output report.html [--analysis analysis.json] [--costs] [--force]');
      return;
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (!options.input || !options.output) throw new Error('Required: --input usage.json --output report.html.');
  const protectedFiles = [options.input, options.analysis, fileURLToPath(templateUrl), fileURLToPath(import.meta.url)].filter(Boolean);
  if (protectedFiles.some((path) => sameFile(options.output, path))) throw new Error('Output must differ from input, analysis and renderer files, including file aliases.');
  const report = readJson(options.input);
  const analysis = options.analysis ? readJson(options.analysis) : {};
  const html = renderUsageHtml(report, analysis, options);
  writeFileSync(options.output, html, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
  console.log(JSON.stringify({ output: options.output, rows: report.rows.length, period: report.period, fromDate: report.fromDate, toDate: report.toDate, timeZone: report.timeZone, costsIncluded: options.costs === true }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Report not generated: ${error.message}`); process.exitCode = 1; }
}
