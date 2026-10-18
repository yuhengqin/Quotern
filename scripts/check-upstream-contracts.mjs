import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 512 * 1024;
const DOCUMENT_HOSTS = new Set(['learn.chatgpt.com', 'support.claude.com', 'code.claude.com']);
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;

function validManifest(value) {
  if (value?.version !== 1 || !Array.isArray(value.upstreams) || !value.upstreams.length || value.upstreams.length > 100) return false;
  const ids = new Set();
  return value.upstreams.every(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-z0-9-]+$/.test(row.id) || ids.has(row.id)) return false;
    if (typeof row.package !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(row.package)) return false;
    if (typeof row.repository !== 'string' || !/^https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(row.repository)) return false;
    if (row.verifiedVersion !== null && (typeof row.verifiedVersion !== 'string' || !versionPattern.test(row.verifiedVersion))) return false;
    if (!Array.isArray(row.contracts) || !row.contracts.length || row.contracts.some(field => typeof field !== 'string' || !field || field.length > 256)) return false;
    if (row.documents !== undefined && (!Array.isArray(row.documents) || row.documents.length > 5 || row.documents.some(document => {
      try {
        const url = new URL(document.url);
        return url.protocol !== 'https:' || !DOCUMENT_HOSTS.has(url.hostname) || url.username || url.password || url.port
          || !Array.isArray(document.requiredText) || !document.requiredText.length || document.requiredText.some(text => typeof text !== 'string' || !text || text.length > 256);
      } catch { return true; }
    }))) return false;
    ids.add(row.id); return true;
  });
}

async function boundedText(response, maxBytes = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('response-too-large');
  if (!response.body) throw new Error('empty-response');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('response-too-large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

function documentText(html) {
  const entities = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>' };
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&([a-z]+);/gi, (all, key) => entities[key.toLowerCase()] ?? all)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_all, code) => { const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return value <= 0x10ffff ? String.fromCodePoint(value) : ' '; })
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function checkUpstreamContracts(manifest, deps = {}) {
  if (!validManifest(manifest)) return finish([{ id: 'manifest', status: 'check-failed', reason: 'invalid-manifest' }]);
  const fetchImpl = deps.fetch ?? fetch;
  const results = await Promise.all(manifest.upstreams.map(async upstream => {
    const row = { ...upstream, latestVersion: null, status: 'check-failed', reason: null };
    try {
      const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(upstream.package)}/latest`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw new Error(`http-${response.status}`);
      let metadata;
      try { metadata = JSON.parse(await boundedText(response)); }
      catch (error) { throw new Error(error.message === 'response-too-large' ? error.message : 'invalid-metadata'); }
      if (typeof metadata.version !== 'string' || !versionPattern.test(metadata.version)) throw new Error('missing-version');
      row.latestVersion = metadata.version;
      row.status = upstream.verifiedVersion === metadata.version ? 'unchanged' : 'review-required';
      row.reason = upstream.verifiedVersion === null ? 'no-verified-baseline' : upstream.verifiedVersion === metadata.version ? 'same-version' : 'version-changed';
    } catch (error) {
      row.reason = /^(?:http-\d{3}|response-too-large|empty-response|invalid-metadata|missing-version)$/.test(error?.message ?? '') ? error.message : 'network-or-timeout';
    }
    return row;
  }));
  const documents = await Promise.all(manifest.upstreams.flatMap(upstream => (upstream.documents ?? []).map(async (document, index) => {
    const row = { id: `${upstream.id}:document-${index + 1}`, kind: 'document', url: document.url, requiredText: document.requiredText, missingText: [], status: 'check-failed', reason: null };
    try {
      const response = await fetchImpl(document.url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error(`http-${response.status}`);
      const body = documentText(await boundedText(response, 3 * 1024 * 1024));
      row.missingText = document.requiredText.filter(text => !body.includes(text.toLowerCase().replace(/\s+/g, ' ').trim()));
      row.status = row.missingText.length ? 'review-required' : 'unchanged';
      row.reason = row.missingText.length ? 'public-wording-changed' : 'public-wording-present';
    } catch (error) { row.reason = /^http-\d{3}$/.test(error?.message ?? '') ? error.message : 'document-request-failed'; }
    return row;
  })));
  return finish([...results, ...documents]);
}

function finish(rows) {
  const results = rows.sort((a, b) => a.id.localeCompare(b.id));
  const status = results.some(row => row.status === 'check-failed') ? 'check-failed'
    : results.some(row => row.status === 'review-required') ? 'review-required' : 'unchanged';
  return { version: 1, status, fingerprint: createHash('sha256').update(JSON.stringify(results)).digest('hex'), results };
}

export function renderContractReport(report) {
  const labels = { 'unchanged': '基线版本一致', 'review-required': '需要复核', 'check-failed': '检查失败' };
  const lines = ['# 上游用量协议复核', '', `状态：${labels[report.status]}。`, '',
    '版本变化是复核信号，不代表协议已经损坏。没有验证基线时保持待复核；通过旧样例测试不能证明新版本兼容。', '',
    '| 上游 | 已验证版本 | 当前版本 | 结果 |', '| --- | --- | --- | --- |'];
  for (const row of report.results) lines.push(`| ${row.id} | ${row.kind === 'document' ? '公开语义探针' : row.verifiedVersion ?? '未建立'} | ${row.kind === 'document' ? row.status === 'unchanged' ? '短语仍在' : row.status === 'review-required' ? '短语缺失' : '未取得' : row.latestVersion ?? '未取得'} | ${labels[row.status]} (${row.reason}) |`);
  for (const row of report.results.filter(row => row.contracts)) {
    lines.push('', `## ${row.id}`, '', `[上游源码](${row.repository}) · npm \`${row.package}\``, '',
      ...row.contracts.map(contract => `- \`${contract}\``));
  }
  for (const row of report.results.filter(row => row.kind === 'document')) lines.push('', `[${row.id}](${row.url})`, '', ...row.missingText.map(text => `- 待复核短语：\`${text}\``));
  lines.push('', '复核后运行脱敏解析测试并记录来源版本，再更新 verifiedVersion。自动任务不推进验证基线。', '', `指纹：\`${report.fingerprint}\``, '');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback;
  const output = resolve(option('--output', '.quotern-dev/upstream-contracts/report.json'));
  const markdown = resolve(option('--markdown', '.quotern-dev/upstream-contracts/report.md'));
  let report;
  try { report = await checkUpstreamContracts(JSON.parse(await readFile(new URL('./upstream-contracts.json', import.meta.url), 'utf8'))); }
  catch { report = finish([{ id: 'manifest', status: 'check-failed', reason: 'unreadable-manifest' }]); }
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await mkdir(dirname(markdown), { recursive: true }); await writeFile(markdown, renderContractReport(report));
  console.log(`Upstream contracts: ${report.status}; report: ${output}`);
  process.exitCode = report.status === 'check-failed' ? 1 : report.status === 'review-required' ? 2 : 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
