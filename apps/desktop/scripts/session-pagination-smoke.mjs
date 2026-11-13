// Built HTTP and IPC renderer acceptance against real Core query routes and synthetic metadata.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { registerAppearanceFixture } from './appearance-fixture.mjs';
import { createLocalApiApp, BucketStore } from '../../../packages/core/dist/index.js';
import { buildAchievementFacts } from '../../../packages/core/dist/achievements/facts.js';
import { evaluateAchievements } from '../../../packages/core/dist/achievements/evaluate.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../../../packages/core/dist/quota/shared/quota.js';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? path.join(workspace, `.quotern-dev/session-pagination-ui-${Date.now()}-${process.pid}`));
const dashboardOnly = process.argv.includes('--dashboard-fixes-only');
const heatmapOnly = process.argv.includes('--heatmap-legend-only');
const closeBands = process.argv.includes('--heatmap-close-bands');
assert.ok(!existsSync(output), 'Use a fresh acceptance directory');
await mkdir(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const debugPort = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
const referenceTime = '2026-10-25T12:00:00Z';
const longProject = 'https://ghuntley.com/allocations/a-very-long-project-name-with-a-recognizable-ending';
const parentTitle = '评估桌面宠物复刻可行性';
const longModel = 'model-with-a-very-long-selected-name-for-compact-related-session-filters';
const displayTitles = { 74: parentTitle, 72: '检查 REA MCP 可用性', 71: '规划云服务器演示部署', 70: '查找 Windows 安装目录选项', 69: '分析 AgentGauge 可吸收功能', 68: '适配桌面宠物交互', 79: '调研交互方案' };
const messages = [], observations = [], evidence = [], titles = [];
for (let index = 0; index < 84; index++) {
  const child = index >= 75, sessionId = `fixture-${index}`, timestamp = new Date(Date.parse('2026-10-25T03:00:00Z') + index * 60_000).toISOString();
  const parentId = index === 75 ? 'fixture-0' : index >= 80 ? `fixture-${index - 1}` : 'fixture-74';
  const tokens = index === 83 ? 9_999_999_999 : (100 + index) * 100_000;
  messages.push({ source: 'claude', sessionId, id: sessionId, role: 'assistant', timestamp, projectLabel: index === 72 ? longProject : index === 74 || child ? 'Quotern' : index % 2 ? 'Alpha' : 'Beta' });
  observations.push({ source: 'claude', sessionId, id: sessionId, timestamp, model: index === 79 ? longModel : index >= 80 ? 'model-b' : index % 2 ? 'model-a' : 'model-b', tokens, usageKnown: true, costUsd: index === 83 ? 123456.78 : index / 4, costKind: 'recorded', tokenParts: { input_tokens: tokens - 20, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 }, billing: { service: 'anthropic', mode: 'api', accountRef: null, evidence: 'recorded' } });
  evidence.push({ source: 'claude', sessionId, id: 'meta', timestamp, kind: 'metadata', ...(child ? { parentId, relationKind: 'subagent' } : {}),
    ...(index === 76 ? { agentNickname: 'Ada', agentRole: 'explorer' } : index === 77 ? { agentRole: 'reviewer' } : index === 80 ? { agentNickname: 'Grace-with-a-very-long-trusted-agent-nickname', agentRole: 'code_explorer-with-a-very-long-role' } : {}) });
  if (index !== 73 && (index < 76 || index === 79)) titles.push([JSON.stringify(['claude', sessionId]), { title: displayTitles[index] ?? (child ? `Child ${index}` : `Fixture ${index}`), priority: 2 }]);
}
const bucketStore = new BucketStore();
if (dashboardOnly || heatmapOnly) {
  const bucket = (source, model, project, tokens, reportedCost) => ({
    source, model, project, hour_start: '2026-10-25T03:00:00Z', input_tokens: tokens,
    output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0, total_tokens: tokens, conversation_count: 1,
    ...(reportedCost == null ? {} : { reported_cost_usd: reportedCost }),
  });
  bucketStore.apply(closeBands ? [1_000_000, 1_001_000, 1_002_000, 1_003_000].map((tokens, index) => ({
    ...bucket('cursor', 'model-a', longProject, tokens, 1), hour_start: `2026-10-${21 + index}T03:00:00Z`,
  })) : [
    { ...bucket('cursor', 'model-a', longProject, 1_000_000, 715.06), input_tokens: 650_000, output_tokens: 100_000,
      cached_input_tokens: 200_000, cache_creation_input_tokens: 30_000, reasoning_output_tokens: 20_000 },
    bucket('cursor', 'tiny-reported-model', 'Tiny', 1_000, 0.004),
    bucket('claude', 'gpt-4o-mini', 'Tiny', 10, null),
    ...['Beta', 'Gamma', 'Delta', 'Epsilon', 'unknown'].map((project, i) => bucket('cursor', i === 4 ? longModel : 'free-model-' + i, project, 500 + i, i === 0 ? 0.006 : 0.001)),
  ]);
}
const facts = buildAchievementFacts([], [], [], new Date(referenceTime));
const achievementSnapshot = evaluateAchievements(facts);
if (heatmapOnly) achievementSnapshot.summary.activeDays = 1;
const demo = { schemaVersion: 1, readOnly: true, referenceTime, exportedAt: referenceTime, collectSince: '2026-10-01T00:00:00Z', lastSyncAt: referenceTime, buckets: [], pricing: { builtin: { exact: {} }, overlay: null },
  history: { messages, observations, timingEvents: [], evidence, titles, codexParents: [], missingSources: [] },
  achievements: { ...achievementSnapshot, earned: [], preferences: { showcaseIds: [], celebrationsEnabled: false }, unreadIds: [], coverage: { fromDate: '2026-10-01', asOfDate: '2026-10-25', timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: [] } } };
const hono = createLocalApiApp({ dataDir: path.join(output, 'must-not-create'), bucketStore, demo, getConfig: () => ({ deviceId: 'fixture', statsSince: demo.collectSince, localCollectSince: demo.collectSince }) });
const calls = [], clients = [], windows = [], checks = [];
let failurePage = 0, server;
async function api(route, init = {}) {
  const url = new URL(route, 'http://localhost');
  calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
  if (heatmapOnly && url.pathname === '/functions/tud-achievements' && init.method === 'POST') return { status: 200, body: { success: true, message: 'ok', data: { snapshot: demo.achievements } } };
  // Opening the ordinary dashboard asks to ensure its collection range. Keep
  // this synthetic, read-only fixture in place instead of starting collection.
  if (url.pathname === '/functions/tud-ensure-local-range') return { status: 200, body: { success: true, message: 'ok', data: { expanded: false, localCollectSince: demo.collectSince, statsSince: demo.collectSince, sync: null, message: 'fixture' } } };
  if (url.pathname === '/functions/tud-session-list' && Number(url.searchParams.get('page')) === failurePage) return { status: 500, body: { success: false, message: 'FIXTURE_PAGE_FAILURE', data: null } };
  const response = await hono.request(route, init);
  const text = await response.text();
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : { success: false, message: text, data: null } };
}
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await wait(75); } throw Error('Timed out: ' + label); };
async function captureSettled(window, filename) {
  // A hidden window can still hold the previous compositor frame. Prime capture,
  // invalidate it, then record the repainted state rather than a stale selection.
  await window.webContents.capturePage();
  window.webContents.invalidate();
  await wait(150);
  await writeFile(filename, (await window.webContents.capturePage()).toPNG());
}
async function connect(window) {
  // These snapshots verify static layout; hidden-window compositor clocks must
  // not freeze a menu halfway through its exit animation over the next state.
  await window.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
  let target;
  await until(async () => { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === window.webContents.getURL()); return Boolean(target); }, 'debugger');
  const client = await connectPage(target); clients.push(client); return client;
}
const activePage = `document.querySelector('footer [aria-current="page"]')?.textContent.trim()`;
const pageButton = page => `document.querySelector('footer button[aria-label="转到第 ${page} 页"]')`;
async function assertSelectTextFits(client, trigger, label) {
  const values = await client.evaluate(`(() => {
    const target = (${trigger}), buttons = target instanceof Element ? [target] : [...target];
    return buttons.filter(button => button.getClientRects().length).map(button => {
      const value = button.querySelector('.select__value, .autocomplete__value');
      const outer = button.getBoundingClientRect(), inner = value.getBoundingClientRect();
      return { text: value.textContent, height: value.clientHeight, scrollHeight: value.scrollHeight,
        lineHeight: parseFloat(getComputedStyle(value).lineHeight),
        centerDelta: Math.abs(inner.top + inner.height / 2 - outer.top - outer.height / 2) };
    });
  })()`);
  assert.ok(values.length > 0, label + ' has visible picker text');
  for (const geometry of values) assert.ok(geometry.height >= geometry.lineHeight && geometry.scrollHeight <= geometry.height + 1 && geometry.centerDelta <= 1,
    label + ' keeps its text complete and vertically centered: ' + JSON.stringify(geometry));
}
const allPickers = 'document.querySelectorAll(".select__trigger, .autocomplete__trigger")';
async function exercise(window, client, mode) {
  await until(() => client.evaluate(`${activePage}==='4' && document.querySelector('section[aria-label="全部会话"]')?.getAttribute('aria-busy')==='false'`), mode + ' initial server page');
  await assertSelectTextFits(client, allPickers, mode + ' session filters and pagination');
  assert.ok(calls.some(call => call.path.endsWith('session-list') && call.query.page === '4'));
  assert.equal(calls.some(call => call.path.endsWith('session-detail')), false, 'list loading must not fetch details');
  assert.equal(await client.evaluate('document.querySelectorAll("[data-session-trigger]").length'), 12);
  assert.equal(await client.evaluate('document.querySelector("[data-session-count]")?.textContent.trim()'), '75 条主会话 · 含关联共 84 条');
  await client.evaluate(`(${pageButton(7)}).focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate(`${activePage}==='7'`), mode + ' keyboard last page');
  assert.equal(await client.evaluate(`document.querySelector('footer button[aria-label="下一页"]').disabled`), true);
  await client.evaluate('history.back(); true');
  await until(() => client.evaluate(`${activePage}==='4'`), mode + ' history restores page');
  await client.fill(`document.querySelector('footer input')`, '2');
  await client.key('Enter');
  await until(() => client.evaluate(`${activePage}==='2'`), mode + ' jump page');
  await client.click(`document.querySelector('footer [aria-haspopup="listbox"]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), 'page size menu');
  await client.click(`[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.includes('24'))`);
  await until(() => client.evaluate(`${activePage}==='1' && (location.search+location.hash).includes('pageSize=24')`), mode + ' capacity resets page');
  assert.equal(await client.evaluate('document.querySelectorAll("[data-session-trigger]").length'), 24);
  const search = `document.querySelector('input[placeholder="名称、项目、模型或会话 ID"]')`;
  await client.fill(search, parentTitle);
  await until(() => client.evaluate('document.querySelectorAll("[data-session-trigger]").length===1 && document.querySelector("[data-session-count]")?.textContent.trim()==="1 条主会话"'), mode + ' search before paging');
  assert.equal(await client.evaluate(`document.activeElement===${search}`), true, 'search retains focus during asynchronous queries');
  const before = calls.filter(call => call.path.endsWith('session-detail')).length;
  await client.click('document.querySelector("[data-session-trigger]")');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog] table"))'), mode + ' on-demand detail');
  assert.equal(calls.filter(call => call.path.endsWith('session-detail')).length, before + 1);
  assert.equal(calls.at(-1).path.includes('session-activity'), false);
  await client.click(`document.querySelector('button[aria-label="关闭会话详情"]')`);
  await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'close detail');
  await client.fill(search, ' ');
  await until(() => client.evaluate('document.querySelectorAll("[data-session-trigger]").length===24'), 'restore full result');
  failurePage = 2;
  await client.click(pageButton(2));
  await until(() => client.evaluate('document.body.innerText.includes("会话读数暂未更新")'), mode + ' failed page feedback');
  assert.equal(await client.evaluate(`(${pageButton(1)}).disabled`), false, 'a failed page must leave navigation enabled');
  assert.equal(await client.evaluate(`(location.search+location.hash).includes('page=2')`), true, 'old page must not normalize the failed URL');
  failurePage = 0;
  await client.click(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='重试')`);
  await until(() => client.evaluate(`${activePage}==='2' && !document.body.innerText.includes('会话读数暂未更新')`), mode + ' retry failed query directly');
  await client.click(pageButton(1));
  await until(() => client.evaluate(`${activePage}==='1' && !document.body.innerText.includes('FIXTURE_PAGE_FAILURE')`), mode + ' return after failure');
  failurePage = 0;
  await client.click('document.querySelector(".search-field__clear-button")');
  assert.equal(await client.evaluate(`(${search}).value`), '', 'the search clear action restores its placeholder');
  await until(() => client.evaluate('document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' stable first page');
  const row74 = `[...document.querySelectorAll('[data-session-row]')].find(el=>el.querySelector('[data-session-title]')?.textContent===${JSON.stringify(parentTitle)})`;
  const disclosure = `(${row74}).querySelector('[data-session-disclosure]')`;
  assert.equal(await client.evaluate(`Boolean(document.querySelector('button button'))`), false, 'disclosure and detail triggers must not be nested');
  assert.equal(await client.evaluate('document.querySelector("[data-session-sort]").getClientRects().length'), 0, 'wide sorting uses the column headers');
  assert.ok(await client.evaluate('Boolean([...document.querySelectorAll("[data-session-trigger]")].some(el=>el.querySelector("[data-session-title]")?.textContent==="未命名会话" && el.querySelector("[data-session-short-id]")?.textContent==="xture-73"))'), 'unnamed sessions retain a separate short identity');
  const longProjectRow = `[...document.querySelectorAll('[data-session-row]')].find(el=>el.querySelector('[data-session-title]')?.textContent===${JSON.stringify(displayTitles[72])})`;
  assert.equal(await client.evaluate(`(${longProjectRow}).querySelector('[data-session-project]')?.getAttribute('title')`), longProject, 'full project identity remains available');
  assert.equal(await client.evaluate(`[...(${longProjectRow}).querySelectorAll('[data-session-project] > [aria-hidden]')].map(el=>el.textContent).join('').includes('…')`), true, 'long project display preserves both ends');
  assert.equal(await client.evaluate('document.querySelector("[data-session-tokens] > span").getBoundingClientRect().width<=1'), true, 'wide rows do not repeat the Token suffix');
  const heights = await client.evaluate('[...document.querySelectorAll("[data-session-row]")].map(el=>el.firstElementChild.getBoundingClientRect().height)');
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, 'collapsed related and standalone rows have equal heights');
  const detailsBeforeDisclosure = calls.filter(call => call.path.endsWith('session-detail')).length;
  await client.evaluate(`(${disclosure}).focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate(`(${disclosure}).getAttribute('aria-expanded')==='true' && document.querySelectorAll('[data-session-trigger]').length===28`), mode + ' inline keyboard disclosure');
  assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'disclosure must not open details');
  assert.equal(calls.filter(call => call.path.endsWith('session-detail')).length, detailsBeforeDisclosure, 'disclosure uses the summary rows');
  const children = `document.getElementById((${disclosure}).getAttribute('aria-controls'))`;
  assert.equal(await client.evaluate(`(${children}).querySelector('[data-related-toolbar] p').textContent`), '关联会话', 'the local filter has a visible scope');
  const child76 = `[...(${children}).querySelectorAll('[data-session-trigger]')].find(el=>el.querySelector('[data-session-short-id]')?.textContent==='xture-76')`;
  assert.equal(await client.evaluate(`(${child76}).querySelector('[data-session-title]').textContent`), 'Ada', 'trusted nickname arrives through the lightweight API');
  assert.equal(await client.evaluate(`(${child76}).querySelector('[data-session-short-id]').textContent`), 'xture-76');
  const aligned = await client.evaluate(`['project','activity','tokens','cost'].map(name=>{ const a=(${row74}).querySelector('[data-session-'+name+']').getBoundingClientRect(),b=(${child76}).querySelector('[data-session-'+name+']').getBoundingClientRect();return {name,delta:Math.abs((name==='tokens'||name==='cost'?a.right:a.left)-(name==='tokens'||name==='cost'?b.right:b.left))}; })`);
  assert.ok(aligned.every(item => item.delta <= 1), mode + ' parent/child column alignment: ' + JSON.stringify(aligned));
  assert.equal(await client.evaluate(`(${child76}).querySelector('[data-session-tokens] > span').getBoundingClientRect().width<=1`), true, 'wide descendants inherit the Token header');
  const nestedDisclosure = `(${children}).querySelector('[data-session-disclosure]')`;
  const treeIndent = await client.evaluate(`({arrow:(${nestedDisclosure}).getBoundingClientRect().left-(${disclosure}).getBoundingClientRect().left,icon:(${nestedDisclosure}).parentElement.querySelector('[data-session-name] > :first-child').getBoundingClientRect().left-(${row74}).querySelector('[data-session-name] > :first-child').getBoundingClientRect().left})`);
  assert.ok(treeIndent.arrow >= 16 && Math.abs(treeIndent.icon - treeIndent.arrow) <= 1, 'the child disclosure and icon indent together: ' + JSON.stringify(treeIndent));
  const toolbarGap = await client.evaluate(`(()=>{const bar=(${children}).querySelector('[data-related-toolbar]'),label=bar.querySelector('p').getBoundingClientRect(),control=bar.querySelector('[aria-haspopup=listbox]').getBoundingClientRect();return control.left-label.right;})()`);
  assert.ok(toolbarGap >= 0 && toolbarGap <= 70, 'the local model filter stays beside its heading: ' + toolbarGap);
  await assertSelectTextFits(client, `(${children}).querySelector('[aria-haspopup=listbox]')`, mode + ' related model filter');
  assert.equal(await client.evaluate(`getComputedStyle((${child76}).querySelector('[data-session-short-id]')).fontSize`), '12px', 'short identities stay readable');
  assert.equal(await client.evaluate(`(${child76}).querySelector('[data-session-short-id]').getBoundingClientRect().top>(${child76}).querySelector('[data-session-title]').getBoundingClientRect().top`), true, 'IDs occupy a separate line');
  await client.click(nestedDisclosure);
  await until(() => client.evaluate(`Boolean(document.querySelector('[data-session-depth="2"]'))`), mode + ' second-level disclosure');
  assert.equal(await client.evaluate(`document.querySelector('[data-session-depth="2"] [data-session-project]').getBoundingClientRect().left===(${row74}).querySelector('[data-session-project]').getBoundingClientRect().left`), true, 'grandchildren retain column alignment');
  assert.equal(await client.evaluate(`(${children}).querySelector('[data-related-model]').textContent.includes('model-b')`), true, 'nested single-model branches also use a static label');
  const assertHit = async expression => {
    assert.equal(await client.evaluate(`(()=>{const el=(${expression});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return [r.left+3,r.left+r.width/2,r.right-3].every(x=>document.elementFromPoint(x,r.top+r.height/2)?.closest('[data-session-disclosure]')===el)})()`), true, 'the entire shifted disclosure remains a separate hit target');
  };
  const expandDeep = async () => {
    for (const level of [2, 3, 4]) {
      const target = `document.querySelector('[data-session-depth="${level}"] [data-session-disclosure]')`;
      await assertHit(target);
      await client.click(target);
      await until(() => client.evaluate(`Boolean(document.querySelector('[data-session-depth="${level + 1}"]'))`), mode + ' deep disclosure ' + level);
    }
    assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'deep disclosure cannot hit the overlapping detail target');
    assert.equal(calls.filter(call => call.path.endsWith('session-detail')).length, detailsBeforeDisclosure, 'deep expansion never fetches details');
    const lines = await client.evaluate(`[...document.querySelectorAll('[data-session-disclosure][aria-expanded=true]')].map(el=>{const region=document.getElementById(el.getAttribute('aria-controls')),child=region.querySelector('[data-session-disclosure]'),line=region.querySelector('[data-session-tree-line]');return !child || line.getBoundingClientRect().left<=child.getBoundingClientRect().left+1})`);
    assert.ok(lines.every(Boolean), 'tree lines stay outside the child disclosure content even after indent caps');
    const nodeGeometry = await client.evaluate(`[...document.querySelectorAll('[data-session-row]')].flatMap(row=>{const arrow=row.querySelector(':scope > [data-session-open-row] > [data-session-disclosure]');if(!arrow)return [];const a=arrow.getBoundingClientRect(),icon=row.querySelector('[data-session-name] > :first-child').getBoundingClientRect(),p=row.querySelector('[data-session-project]').getBoundingClientRect();return [{depth:row.dataset.sessionDepth,centerDelta:Math.abs(a.top+a.height/2-icon.top-icon.height/2),coversProject:a.left<p.right-1&&a.right>p.left+1&&a.top<p.bottom-1&&a.bottom>p.top+1}]})`);
    assert.ok(nodeGeometry.every(node => node.centerDelta <= 1 && !node.coversProject), 'disclosures align with icons and never cover project text: ' + JSON.stringify(nodeGeometry));
    const lineOverlaps = await client.evaluate(`(()=>{const text=[...document.querySelectorAll('[data-session-project],[data-session-activity],[data-session-tokens],[data-session-cost]')].map(el=>el.getBoundingClientRect());return [...document.querySelectorAll('[data-session-expanded-mark],[data-session-tree-line]')].map(el=>el.getBoundingClientRect()).some(line=>text.some(r=>line.left<r.right && line.right>r.left && line.top<r.bottom && line.bottom>r.top))})()`);
    assert.equal(lineOverlaps, false, 'expanded marks and tree guides never cross metadata or numeric text');
  };
  await expandDeep();
  await client.click(`document.querySelector('[data-session-depth="2"] [data-session-disclosure]')`);
  await client.click(nestedDisclosure);
  await client.click(`(${children}).querySelector('[aria-haspopup=listbox]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), 'related model filter');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='model-b')`);
  await client.click(disclosure);
  await client.click(disclosure);
  assert.equal(await client.evaluate(`(${children}).querySelector('[aria-haspopup=listbox]').textContent.includes('model-b')`), true, 'collapsing preserves the child model filter');
  await client.click(`(${children}).querySelector('[aria-haspopup=listbox]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), 'clear related model filter');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='全部模型')`);
  await until(() => client.evaluate(`(${children}).querySelectorAll('[data-session-depth="1"]').length===4 && (${children}).querySelector('[aria-haspopup=listbox]').textContent.includes('全部')`), mode + ' related all-model results');
  await client.click(`(${children}).querySelector('[aria-haspopup=listbox]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' long model menu');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()===${JSON.stringify(longModel)})`);
  await until(() => client.evaluate(`(${children}).querySelectorAll('[data-session-depth="1"]').length===1`), mode + ' long model selection');
  await assertSelectTextFits(client, `(${children}).querySelector('[aria-haspopup=listbox]')`, mode + ' long selected model');
  await client.click(`(${children}).querySelector('[aria-haspopup=listbox]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' restore all models menu');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='全部模型')`);
  await until(() => client.evaluate(`(${children}).querySelectorAll('[data-session-depth="1"]').length===4`), mode + ' restore all models');
  const childTrigger = `(${nestedDisclosure}).parentElement.querySelector('[data-session-trigger]')`;
  const hoverPoint = await client.evaluate(`(()=>{const el=(${childTrigger});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.right-8,y:r.top+r.height/2}})()`);
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint });
  assert.notEqual(await client.evaluate(`getComputedStyle((${disclosure}).parentElement).backgroundColor`), await client.evaluate(`getComputedStyle(${childTrigger}).backgroundColor`), 'expanded and hovered rows have distinct backgrounds');
  await captureSettled(window, path.join(output, mode + '-related-hover.png'));
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 });
  await captureSettled(window, path.join(output, mode + '-related.png'));
  await client.evaluate('document.documentElement.classList.add("dark"); true');
  await wait(100);
  await captureSettled(window, path.join(output, mode + '-related-dark.png'));
  await client.evaluate('document.documentElement.classList.remove("dark"); true');
  await client.click(disclosure);
  await client.click(`document.querySelector('button[aria-label="Token · 降序"]')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("sort=tokens") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' column sorting');
  await client.click(`document.querySelector('button[aria-label="Token · 升序"]')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("direction=ascending") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' column direction');
  await client.click(`document.querySelector('button[aria-label="任务时长 · 降序"]')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("sort=duration") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' wide duration sort');
  await client.click(`document.querySelector('button[aria-label="最近活动 · 降序"]')`);
  await until(() => client.evaluate('!document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")?.includes("true") && document.querySelector("[data-session-count]")?.textContent.includes("75")'), mode + ' restore recent sorting');
  await client.evaluate('document.querySelector("h1").scrollIntoView({block:"start"}); true');
  await wait(150);
  await captureSettled(window, path.join(output, mode + '-pagination.png'));
  await client.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await client.evaluate('document.querySelector("h1").scrollIntoView({block:"start"}); true');
  await wait(150);
  assert.equal(await client.evaluate('document.querySelector("[data-session-tokens] > span").getBoundingClientRect().width>1'), true, 'stacked rows retain the Token unit');
  await assertSelectTextFits(client, 'document.querySelector("[data-session-sort]")', mode + ' narrow sort filter');
  await client.click('document.querySelector("[data-session-sort]")');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' narrow combined sorting');
  assert.equal(await client.evaluate('document.querySelectorAll("[role=option]").length'), 8, 'all four sort fields retain both directions');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='任务时长 · 升序')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("sort=duration") && (location.search+location.hash).includes("direction=ascending") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' narrow duration direction');
  await client.click('document.querySelector("[data-session-sort]")');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' narrow recent menu');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='最近活动 · 降序')`);
  await until(() => client.evaluate('document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false" && !document.querySelector("[role=listbox]")'), mode + ' restore narrow recent sorting');
  await client.click(disclosure);
  await until(() => client.evaluate(`(${disclosure}).getAttribute('aria-expanded')==='true'`), mode + ' narrow related disclosure');
  await assertSelectTextFits(client, `(${children}).querySelector('[aria-haspopup=listbox]')`, mode + ' narrow related model filter');
  await client.click(nestedDisclosure);
  await until(() => client.evaluate(`Boolean(document.querySelector('[data-session-depth="2"]'))`), mode + ' narrow second-level disclosure');
  assert.equal(await client.evaluate(`(${child76}).querySelector('[data-session-tokens] > span').getBoundingClientRect().width>1`), true, 'narrow descendants keep the Token unit');
  await expandDeep();
  const overlaps = await client.evaluate(`[...document.querySelectorAll('[data-session-depth]')].flatMap(row=>{const trigger=row.querySelector('[data-session-trigger]'),tokens=trigger.querySelector('[data-session-tokens]').getBoundingClientRect();return [...trigger.querySelectorAll('[data-session-name],[data-session-short-id],[data-session-role]')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return r.left<tokens.right-1 && r.right>tokens.left+1 && r.top<tokens.bottom-1 && r.bottom>tokens.top+1})})`);
  assert.ok(overlaps.every(value => !value), 'deep narrow identity text never overlaps numeric text');
  assert.equal(await client.evaluate(`(${child76}).querySelector('[data-session-title]').scrollWidth<=(${child76}).querySelector('[data-session-title]').clientWidth`), true, 'a short trusted nickname stays fully readable');
  assert.equal(await client.evaluate(`[...document.querySelectorAll('[data-session-short-id]')].every(el=>el.scrollWidth<=el.clientWidth)`), true, 'short IDs remain complete in narrow deep rows');
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 });
  await captureSettled(window, path.join(output, mode + '-related-deep-narrow.png'));
  await client.click(`document.querySelector('[data-session-depth="2"] [data-session-disclosure]')`);
  await until(() => client.evaluate(`!document.querySelector('[data-session-depth="3"]')`), mode + ' restore the ordinary narrow subtree');
  await client.evaluate(`(${row74}).style.scrollMarginTop='16px';(${row74}).scrollIntoView({block:'start'});true`);
  await wait(100);
  assert.equal(await client.evaluate(`(${row74}).firstElementChild.getBoundingClientRect().top>=0`), true, 'the narrow screenshot includes the complete parent row');
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 });
  await wait(100);
  await captureSettled(window, path.join(output, mode + '-related-narrow.png'));
  await client.evaluate('document.querySelector("h1").scrollIntoView({block:"start"}); true');
  await wait(150);
  await captureSettled(window, path.join(output, mode + '-pagination-narrow.png'));
  await client.evaluate('document.querySelector("footer").scrollIntoView({block:"end"}); true');
  await wait(150);
  await captureSettled(window, path.join(output, mode + '-pagination-footer-narrow.png'));
  const overflow = await client.evaluate(`({ viewport: innerWidth, width: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.right>innerWidth+1}).slice(0,12).map(el=>({tag:el.tagName,classes:el.className,text:el.textContent?.slice(0,80),right:el.getBoundingClientRect().right})) })`);
  assert.ok(overflow.width <= overflow.viewport + 1, mode + ' narrow overflow: ' + JSON.stringify(overflow));
  await client.call('Emulation.clearDeviceMetricsOverride');
  await client.click(pageButton(4));
  await until(() => client.evaluate(`${activePage}==='4' && document.querySelector('section[aria-label="全部会话"]')?.getAttribute('aria-busy')==='false'`), mode + ' single-model parent page');
  const single = `[...document.querySelectorAll('[data-session-row]')].find(el=>el.querySelector('[data-session-title]')?.textContent==='Fixture 0')`;
  await client.click(`(${single}).querySelector('[data-session-disclosure]')`);
  assert.equal(await client.evaluate(`(${single}).querySelector('[data-related-model]').textContent.includes('model-a')`), true, 'one model is a static readable label');
  assert.equal(await client.evaluate(`(${single}).querySelector('[data-session-related] [aria-haspopup=listbox]')===null`), true, 'one model needs no ineffective filter');
  const agentFilter = 'document.querySelector("[aria-label=会话筛选] .select__trigger")';
  await client.click(agentFilter);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' Agent filter menu');
  await client.click('[...document.querySelectorAll("[role=option]")].find(el => el.textContent.includes("Claude"))');
  await client.key('Escape');
  await until(() => client.evaluate(`(${agentFilter}).textContent.includes('Claude') && !document.querySelector('[role=listbox]') && document.querySelector('section[aria-label=全部会话]')?.getAttribute('aria-busy')==='false'`), mode + ' selected Agent icon');
  await client.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await assertSelectTextFits(client, agentFilter, mode + ' narrow selected Agent icon');
  await client.call('Emulation.clearDeviceMetricsOverride');
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  checks.push(mode + '-server-paging-keyboard-history-jump-capacity-search-detail-error-narrow', mode + '-counts-inline-relations-labels-units-responsive-sorting', mode + '-related-identities-columns-nesting-models-narrow');
}

async function exerciseCompactFilters(window, client, mode) {
  const navigate = async route => {
    if (mode === 'browser') await window.loadURL(`http://127.0.0.1:${server.address().port}${route}`);
    else await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: route });
    await window.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
  };
  for (const width of [1120, 375]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate('/');
    await until(() => client.evaluate('Boolean(document.querySelector("[role=group][aria-label=时间粒度] .select__trigger"))'), mode + ' dashboard trend filters');
    await assertSelectTextFits(client, allPickers, mode + ' dashboard filters ' + width);
    assert.equal(await client.evaluate('document.querySelectorAll("a[href*=billing], [aria-label=费用与余额]").length'), 0, mode + ' removes the platform billing entry');
    assert.equal(await client.evaluate('Boolean(document.querySelector("a[href*=pricing]"))'), true, mode + ' keeps model pricing navigation');
    assert.equal(await client.evaluate('Boolean(document.querySelector("a[href*=sessions]"))'), true, mode + ' keeps session navigation');
    assert.equal(await client.evaluate('Boolean(document.querySelector("button[aria-label=设置]"))'), true, mode + ' keeps settings');
    assert.equal(calls.some(call => call.path.startsWith('/functions/tud-billing')), false, mode + ' does not request removed billing endpoints');
    await captureSettled(window, path.join(output, `${mode}-dashboard-${width}.png`));
    await client.click('document.querySelector("button[aria-label=分享]")');
    await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog] .select__trigger"))'), mode + ' share filters');
    await assertSelectTextFits(client, 'document.querySelectorAll("[role=dialog] .select__trigger")', mode + ' share filters ' + width);
    await captureSettled(window, path.join(output, `${mode}-compact-share-${width}.png`));
    await client.key('Escape');
    await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), mode + ' close share');
    await navigate('/pricing');
    await until(() => client.evaluate('Boolean(document.querySelector("[aria-label=价格筛选条件] .autocomplete__trigger"))'), mode + ' pricing filters');
    await assertSelectTextFits(client, allPickers, mode + ' pricing filters ' + width);
    const providerFilter = 'document.querySelector("[aria-label=价格筛选条件] .autocomplete__trigger")';
    await client.click(providerFilter);
    await until(() => client.evaluate('Boolean(document.querySelector("[role=option]"))'), mode + ' provider options');
    await client.click('document.querySelector("[role=option]")');
    await client.key('Escape');
    await assertSelectTextFits(client, providerFilter, mode + ' selected provider ' + width);
    await client.click('document.querySelector("button[aria-label=清空提供商筛选]")');
    assert.equal(await client.evaluate(`document.activeElement === (${providerFilter}).querySelector('button')`), true, 'clearing a provider restores trigger focus');
    await client.click('[...document.querySelectorAll("[data-slot=popover-trigger]")].find(el => el.textContent.trim() === "更多筛选")');
    await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog] .select__trigger"))'), mode + ' context-window filter');
    await assertSelectTextFits(client, allPickers, mode + ' expanded pricing filters ' + width);
    await captureSettled(window, path.join(output, `${mode}-compact-pricing-${width}.png`));
    await client.key('Escape');
    await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), mode + ' close pricing filters');
  }
  await client.call('Emulation.clearDeviceMetricsOverride');
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  checks.push(mode + '-compact-dashboard-share-pricing-text-wide-narrow');
  checks.push(mode + '-dashboard-navigation-without-platform-billing');
}

async function exerciseDashboardFixes(window, client, mode) {
  const label = text => `document.querySelector('button[aria-label=' + ${JSON.stringify(JSON.stringify(text))} + ']')`;
  const close = async () => { await client.key('Escape'); await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'close overlay'); };
  const shot = async name => captureSettled(window, path.join(output, `${mode}-fix-${name}.png`));
  await until(() => client.evaluate('Boolean(document.querySelector("button[aria-label=\\"查看 Cursor 模型明细\\"]"))'), mode + ' dashboard loaded');
  await client.evaluate('window.__dashboardDocumentStart = performance.timeOrigin; window.dispatchEvent(new CustomEvent("tud:open-settings", {detail:{tab:"app"}})); true');
  if (mode === 'desktop') await until(() => client.evaluate('(()=>{const control=document.querySelector("#desktop-open-at-login");return Boolean(control)&&!control.matches(":disabled,[aria-disabled=true],[data-disabled]")&&!control.querySelector(":disabled")})()'), 'settled Desktop preferences');
  if (mode === 'desktop') await client.evaluate('window.dispatchEvent(new CustomEvent("tud:open-settings", {detail:{tab:"appearance"}})); true');
  await until(() => client.evaluate('Boolean(document.querySelector("input[value=international]"))'), mode + ' token preferences');
  if (mode === 'browser') {
    assert.equal(await client.evaluate('document.querySelector("[role=dialog] [role=tablist]")?.getAttribute("aria-orientation")'), 'vertical', 'browser settings use vertical category tabs');
    assert.deepEqual(await client.evaluate('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].map(tab => tab.textContent.trim())'), ['常规设置', 'Agent 集成', '数据与备份', '关于'], 'browser settings categories keep the fixed order');
    assert.equal(await client.evaluate('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].find(tab => tab.getAttribute("aria-selected") === "true")?.textContent.trim()'), '常规设置', 'legacy app settings event opens General settings');
  }
  await client.click('document.querySelector("input[value=international]").closest("label")');
  await until(() => client.evaluate('document.querySelector("input[value=international]")?.checked && document.querySelector("main").innerText.includes("1M")'), mode + ' reactive number units');
  assert.equal(await client.evaluate('document.querySelector("[data-model-token-share]").innerText.includes("1M Token")'), true, 'model share follows international Token preference');
  assert.equal(await client.evaluate('performance.timeOrigin === window.__dashboardDocumentStart && Boolean(document.querySelector("[role=dialog]"))'), true, 'unit changes preserve the document and settings');
  await shot('units-settings-retained');
  await client.click('document.querySelector("input[value=localized]").closest("label")');
  if (mode === 'browser') {
    await until(() => client.evaluate('document.querySelector("input[value=localized]")?.checked'), 'browser localized number units');
    await client.evaluate('window.dispatchEvent(new CustomEvent("tud:open-settings", {detail:{tab:"sync"}})); true');
    await until(() => client.evaluate('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].some(tab => tab.textContent.trim() === "数据与备份" && tab.getAttribute("aria-selected") === "true")'), 'browser legacy sync settings event');
    assert.equal(await client.evaluate('(()=>{const tab=[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].find(item=>item.getAttribute("aria-selected")==="true"),panel=document.getElementById(tab?.getAttribute("aria-controls"));return Boolean(panel?.querySelector("input[type=file]")&&!panel.querySelector("input[name=token-unit-mode]"))})()'), true, 'Data and backup contains import controls without token unit settings');
    await client.click('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].find(tab => tab.textContent.trim() === "Agent 集成")');
    await until(() => client.evaluate('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].some(tab => tab.textContent.trim() === "Agent 集成" && tab.getAttribute("aria-selected") === "true")'), 'browser Agent integration tab');
    assert.equal(await client.evaluate('(()=>{const tab=[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].find(item=>item.getAttribute("aria-selected")==="true"),panel=document.getElementById(tab?.getAttribute("aria-controls"));return Boolean(panel?.querySelector("[data-agent-settings]"))})()'), true, 'Agent integration tab renders its settings panel');
    await client.key('End');
    await until(() => client.evaluate('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].some(tab => tab.textContent.trim() === "关于" && tab.getAttribute("aria-selected") === "true")'), 'browser End selects About');
    await client.key('Home');
    await until(() => client.evaluate('[...document.querySelectorAll("[role=dialog] [role=tablist] [role=tab]")].some(tab => tab.textContent.trim() === "常规设置" && tab.getAttribute("aria-selected") === "true")'), 'browser Home selects General settings');
  }
  await close();
  await until(() => client.evaluate('document.querySelector("[data-model-token-share]").innerText.includes("100万 Token")'), mode + ' model share follows localized Token preference');
  const cursor = label('查看 Cursor 模型明细');
  await client.evaluate(`(${cursor}).focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("tiny-reported-model")'), mode + ' keyboard model details');
  assert.equal(await client.evaluate('document.querySelector("[role=dialog]").innerText.includes("<$0.01")'), true, 'subcent amounts survive the real Core to UI path');
  assert.equal(await client.evaluate('document.querySelector("[role=dialog]").innerText.includes("$715.06")'), true);
  await shot('models-subcent-keyboard');
  const bounds = await client.evaluate('(()=>{const d=document.querySelector("[role=dialog]"),r=d.getBoundingClientRect(),p=d.parentElement.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,bottom:r.bottom,surfaceBottom:p.bottom,scrollable:d.scrollHeight>d.clientHeight}})()');
  assert.ok(bounds.bottom <= bounds.surfaceBottom + 1, 'dialog content fits inside the visible surface');
  assert.ok(bounds.scrollable, 'long model lists scroll inside the surface');
  await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bounds.x, y: bounds.y, deltaX: 0, deltaY: 1000 });
  await until(() => client.evaluate('document.querySelector("[role=dialog]").scrollTop > 0'), mode + ' model list scroll');
  await shot('models-scrolled');
  await close();
  await until(() => client.evaluate(`document.activeElement === (${cursor})`), mode + ' focus returns to the row');
  await client.click(label('项目分布说明'));
  await until(() => client.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("按工作目录")'), mode + ' clickable project explanation');
  await shot('project-help');
  await close();
  for (const title of ['Agent 分布指标', '模型分布指标']) {
    await client.click(`[...document.querySelectorAll('[role=tablist][aria-label="${title}"] [role=tab]')].find(el=>el.textContent.trim()==='费用')`);
  }
  const agentCard = `(${label('隐藏 Cursor')}).closest('.card')`;
  assert.equal(await client.evaluate(`(${agentCard}).querySelector('strong').textContent.startsWith('$715.')`), true, 'chart center retains cents');
  await shot('currency');
  await client.click(label('隐藏 Cursor'));
  await until(() => client.evaluate('document.body.innerText.includes("显示项合计")'), mode + ' filtered denominator label');
  await shot('visible-total');
  await client.click('[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="恢复全部")');
  assert.equal(await client.evaluate('document.body.innerText.includes("显示项合计")'), false);
  await exerciseModelTokenShare(window, client, mode);
  if (mode === 'browser') {
    await client.click(label('热力图来源：全部 Agent'));
    await until(() => client.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("仅影响热力图")'), 'heatmap scope');
    await client.click('[...document.querySelectorAll("[role=dialog] button")].find(el=>el.textContent.trim()==="取消全选")');
    await shot('heatmap-none');
    await client.click('[...document.querySelectorAll("[role=dialog] button")].find(el=>el.textContent.trim()==="全部")');
    await close();
  }
  for (const width of [1120, 375]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.evaluate('window.scrollTo(0,0); document.querySelector("[data-dashboard-scroll-container]")?.scrollTo(0,0); true');
    await wait(200);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'), true, mode + ' no horizontal overflow');
    const values = await client.evaluate('[...document.querySelectorAll("[aria-label^=\\"预估费用 $\\"], [aria-label^=\\"总 Token \\"], [aria-label^=\\"输入 Token \\"], [aria-label^=\\"输出 Token \\" ]")].filter(el=>el.getClientRects().length).map(el=>({text:el.textContent, fits:el.scrollWidth<=el.clientWidth+1}))');
    assert.ok(values.length >= 4 && values.every(value => value.fits), mode + ' complete primary values: ' + JSON.stringify(values));
    await shot('overview-' + width);
    await client.click('document.querySelector("button[aria-label*=recognizable-ending]")');
    await until(() => client.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("recognizable-ending")'), mode + ' full long project');
    assert.equal(await client.evaluate('(()=>{const heading=document.querySelector("[role=dialog] h2");return heading.scrollWidth<=heading.clientWidth+1})()'), true, 'full name wraps inside the panel');
    await shot('project-details-' + width);
    await close();
  }
  await client.call('Emulation.clearDeviceMetricsOverride');
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  checks.push(mode + '-units-without-reload', mode + '-raw-subcent-and-chart-precision', mode + '-model-details-keyboard-focus', mode + '-project-help-and-long-name', mode + '-visible-denominator-restore', mode + '-complete-values-wide-narrow');
}

async function exerciseModelTokenShare(window, client, mode) {
  const card = 'document.querySelector("[data-model-token-share]")';
  const button = name => `(${card}).querySelector('button[aria-label=' + ${JSON.stringify(JSON.stringify(name))} + ']')`;
  const metric = name => `[...(${card}).querySelectorAll('[role=tab]')].find(el=>el.textContent.trim()===${JSON.stringify(name)})`;
  const shot = async name => {
    await client.evaluate(`(${card}).scrollIntoView({block:'center'}); true`);
    await captureSettled(window, path.join(output, `${mode}-model-share-${name}.png`));
  };
  const modelKeys = () => client.evaluate(`[...(${card}).querySelectorAll('[data-model-share-item]')].map(el=>el.dataset.modelShareItem)`);
  assert.equal(await client.evaluate(`(${card}).querySelectorAll('[data-model-share-item]').length`), 6, 'Top5 plus Other');
  assert.equal(await client.evaluate(`Boolean(document.querySelector('button[aria-label="隐藏 Cursor"]').closest('.card').querySelector('.recharts-pie')) && !(${card}).querySelector('.recharts-pie')`), true, 'Agent retains its original donut');
  assert.equal((await modelKeys())[1], 'model:free-model-0', 'cost view is ranked by cost');
  await client.click(metric('Token'));
  await until(async () => (await modelKeys())[1] === 'model:tiny-reported-model', mode + ' Token ranking');
  assert.equal(await client.evaluate(`(${card}).innerText.includes('其他（3 个模型）') && (${card}).innerText.includes('查看全部（8）')`), true, 'complete model count and grouped remainder');
  assert.equal(await client.evaluate(`(()=>{const buttons=[...(${card}).querySelectorAll('.model-share-row')];return buttons.every(button=>{const description=(button.getAttribute('aria-describedby')??'').split(' ').map(id=>document.getElementById(id)?.textContent??'').join(' ');return description.includes('%')&&description.includes('Token')&&description.includes('$')})})()`), true, 'each model and Other exposes share and amounts through accessible descriptions');
  const accessibility = await client.call('Accessibility.getFullAXTree');
  for (const name of ['隐藏 model-a', '查看其他 3 个模型']) {
    const node = accessibility.nodes.find(node => node.role?.value === 'button' && node.name?.value === name);
    assert.ok(node?.description?.value?.includes('%') && node.description.value.includes('Token') && node.description.value.includes('$'), 'renderer accessibility tree includes model values: ' + name);
  }
  await client.click(button('隐藏 model-a'));
  await until(() => client.evaluate(`(${card}).querySelector('[data-model-share-total]').textContent==='3,520'`), mode + ' visible model denominator');
  assert.equal(await client.evaluate(`(${card}).innerText.includes('28.4%') && !(${card}).querySelector('[data-model-share-band="model:model-a"]')`), true, 'shares and ribbon exclude hidden model');
  await client.click(metric('费用'));
  assert.equal(await client.evaluate(`(${button('显示 model-a')})?.getAttribute('aria-pressed')`), 'false', 'metric changes preserve hidden model');
  await client.click(`[...(${card}).querySelectorAll('button')].find(el=>el.textContent.trim()==='恢复全部')`);
  await client.click(metric('Token'));
  const other = button('查看其他 3 个模型');
  await client.evaluate(`(${other}).focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), mode + ' keyboard Other opens all models');
  assert.equal(await client.evaluate('document.querySelectorAll("[role=dialog] button[aria-pressed]").length'), 8, 'complete list retains all models');
  await client.evaluate('document.querySelector("[role=dialog] button[aria-label=\\"隐藏 model-a\\"]").focus(); true');
  await until(() => client.evaluate('document.querySelector("[role=tooltip]")?.innerText.includes("缓存写入")'), mode + ' classification detail on keyboard focus');
  const details = await client.evaluate('document.querySelector("[role=tooltip]").innerText');
  for (const value of ['输入（未缓存）', '65万', '缓存读取', '20万', '缓存写入', '3万', '输出', '10万', '推理', '2万']) assert.ok(details.includes(value), 'retained classification ' + value + ': ' + details);
  await captureSettled(window, path.join(output, `${mode}-model-share-classifications.png`));
  await client.key('Escape');
  await until(() => client.evaluate('!document.querySelector("[role=tooltip]")'), 'tooltip closes before model dialog');
  await client.key('Escape');
  await until(() => client.evaluate(`!document.querySelector('[role=dialog]') && document.activeElement===(${other})`), mode + ' Other restores focus');
  await client.key('Tab');
  for (const width of [1120, 375, 320]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(() => client.evaluate(`(()=>{const body=(${card}).querySelector('.model-share-body');return body.getBoundingClientRect().width>0})()`), 'model layout measured');
    await shot(width);
    assert.equal(await client.evaluate(`(()=>{const root=(${card});return root.scrollWidth<=root.clientWidth+1 && [...root.querySelectorAll('.model-share-name,.model-share-meta')].every(el=>el.scrollWidth<=el.clientWidth+1)})()`), true, 'full long names and model numbers fit ' + width);
    assert.equal(await client.evaluate(`(()=>{const root=(${card}),style=getComputedStyle(root),narrow=root.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)<420;return (getComputedStyle(root.querySelector('[data-model-share-canvas]')).display==='none')===narrow})()`), true, 'ribbon fallback follows the card width');
  }
  await client.call('Emulation.clearDeviceMetricsOverride');
  for (const width of [410, 430]) {
    await client.evaluate(`(${card}).style.boxSizing='content-box'; (${card}).style.inlineSize='${width}px'; true`);
    await until(() => client.evaluate(`getComputedStyle((${card}).querySelector('[data-model-share-canvas]')).display${width < 420 ? '===' : '!=='}'none'`), mode + ' independent card breakpoint ' + width);
  }
  await client.evaluate(`(${card}).style.removeProperty('inline-size'); (${card}).style.removeProperty('box-sizing'); true`);
  for (const [locale, title] of [['en', 'Model distribution'], ['ja', 'モデル別の内訳'], ['ko', '모델 분포'], ['zh-CN', '模型分布']]) {
    if (mode === 'browser') await client.evaluate(`localStorage.setItem('quotern.locale.preference',${JSON.stringify(locale)}); window.dispatchEvent(new StorageEvent('storage',{key:'quotern.locale.preference'})); true`);
    else window.webContents.send('locale:changed', { preference: locale, resolved: locale, systemLocale: 'zh-CN' });
    await until(() => client.evaluate(`(${card}).innerText.includes(${JSON.stringify(title)})`), mode + ' translated model share ' + locale);
    assert.equal(await client.evaluate(`(${card}).innerText.includes('usage.modelShare.')`), false, 'Other labels are translated');
  }
  await client.evaluate('document.documentElement.classList.remove("light"); document.documentElement.classList.add("dark"); document.documentElement.dataset.theme="dark"; true');
  await shot('dark');
  await client.evaluate('document.documentElement.classList.remove("dark"); document.documentElement.classList.add("light"); document.documentElement.dataset.theme="light"; true');
  checks.push(mode + '-model-share-ranking-grouping-hide-restore-full-list-classifications-keyboard-units-responsive-themes-languages');
}

async function exerciseHeatmapHelpScrolling(window, client, mode, help, dialog) {
  const page = mode === 'browser' ? 'document.querySelector("[data-dashboard-scroll-container]")' : 'document.scrollingElement';
  const open = async () => {
    await client.evaluate(`(${help}).scrollIntoView({block:'center'}); (${help}).focus(); true`);
    await captureSettled(window, path.join(output, `${mode}-heatmap-help-before-open.png`));
    await client.key('Enter');
    await until(() => client.evaluate(`Boolean(${dialog}) && !document.querySelector('[data-entering]')`), mode + ' settled help for scrolling');
    await captureSettled(window, path.join(output, `${mode}-heatmap-help-before-scroll.png`));
  };
  const wheel = async (point, deltaY) => {
    await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    return client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY });
  };
  const closedAfterPaint = () => client.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(!${dialog}))))`);

  // Native document scrollbars use the real content bounds, not an emulated viewport.
  await client.call('Emulation.clearDeviceMetricsOverride');
  window.setContentSize(1120, 900);
  await open();
  const wheelBefore = await client.evaluate(`${page}.scrollTop`);
  await wheel({ x: 80, y: 300 }, 160);
  await wait(250);
  const wheelAfter = await client.evaluate(`${page}.scrollTop`);
  const wheelState = await client.evaluate(`({rootOverflow:document.documentElement.style.overflow,pageHeight:${page}.clientHeight,scrollHeight:${page}.scrollHeight,help:!!${dialog}})`);
  await captureSettled(window, path.join(output, `${mode}-heatmap-help-wheel.png`));
  assert.ok(wheelAfter > wheelBefore + 20, mode + ' background wheel scrolls with help open: ' + JSON.stringify({ wheelBefore, wheelAfter, wheelState }));
  assert.equal(await closedAfterPaint(), true, mode + ' page wheel closes help without a lingering overlay');

  await open();
  const scrollBefore = await client.evaluate(`${page}.scrollTop`);
  if (mode === 'browser') {
    const thumb = await client.evaluate(`(()=>{const el=${page},r=el.getBoundingClientRect(),height=Math.max(20,el.clientHeight**2/el.scrollHeight);return {x:r.right-4,y:r.top+el.scrollTop/(el.scrollHeight-el.clientHeight)*(el.clientHeight-height)+height/2}})()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: thumb.x, y: thumb.y });
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: thumb.x, y: thumb.y, button: 'left', clickCount: 1 });
    for (const distance of [25, 50, 75, 100]) {
      await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: thumb.x, y: thumb.y + distance, button: 'left', buttons: 1 });
      await wait(25);
    }
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: thumb.x, y: thumb.y + 100, button: 'left', clickCount: 1 });
  } else {
    // The desktop shell scrolls the document. Exercise its native scroll event
    // directly; the browser shell above additionally verifies a pointer drag.
    await client.evaluate(`${page}.scrollTop += 160; true`);
  }
  await until(() => client.evaluate(`${page}.scrollTop > ${scrollBefore + 20}`), mode + ' page scroll moves the actual scroll container');
  assert.equal(await closedAfterPaint(), true, mode + ' scrollbar drag leaves no detached help');

  await open();
  await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 300, button: 'left', clickCount: 1 });
  await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 80, y: 300, button: 'left', clickCount: 1 });
  await until(() => client.evaluate(`!${dialog}`), mode + ' help retains outside-click dismissal');

  window.setContentSize(375, 360);
  await open();
  await client.evaluate(`${dialog}.querySelector('summary').focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate(`${dialog}.scrollHeight > ${dialog}.clientHeight + 10`), mode + ' expanded help has scrollable content');
  assert.equal(await client.evaluate(`(()=>{const r=${dialog}.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`), true, mode + ' scrollable help stays inside the short viewport');
  const inner = await client.evaluate(`(()=>{const el=${dialog},r=el.getBoundingClientRect();el.scrollTop=0;return {point:{x:r.left+r.width/2,y:r.top+r.height/2},pageTop:${page}.scrollTop}})()`);
  await captureSettled(window, path.join(output, `${mode}-heatmap-help-before-internal-scroll.png`));
  await wheel(inner.point, 160);
  await until(() => client.evaluate(`${dialog}?.scrollTop > 10`), mode + ' wheel scrolls expanded help content');
  await wheel(inner.point, 1000);
  await wait(200);
  assert.equal(await client.evaluate(`Boolean(${dialog}) && ${page}.scrollTop===${inner.pageTop}`), true, mode + ' help scrolling does not move the background or dismiss itself');
  await captureSettled(window, path.join(output, `${mode}-heatmap-help-internal-scroll.png`));
  await client.key('Escape');
  await until(() => client.evaluate(`!${dialog} && document.activeElement===(${help})`), mode + ' scrolled help restores focus');
  window.setContentSize(1120, 900);
  checks.push(mode + '-help-wheel-' + (mode === 'browser' ? 'scrollbar-drag' : 'document-scroll') + '-immediate-dismiss-outside-click-internal-scroll');
}

async function exerciseHeatmapLegend(window, client, mode) {
  const legend = 'document.querySelector("[data-heatmap-legend]")';
  const help = `(${legend}).querySelector('button')`;
  const dialog = 'document.querySelector("[role=dialog]")';
  await until(() => client.evaluate('Boolean(document.querySelector("button[aria-label=\\"查看 Cursor 模型明细\\"]"))'), mode + ' dashboard ready');
  assert.equal(await client.evaluate(`(${legend})?.textContent.includes('每日 Token 用量')`), true, mode + ' legend names the daily Token metric');
  assert.equal(await client.evaluate(`(${legend}).textContent.includes('少') && (${legend}).textContent.includes('多')`), true, 'legend has visible direction labels');
  await until(() => client.evaluate(`Boolean((${legend}).parentElement.querySelector('a[href*=achievements]'))`), mode + ' achievement snapshot ready');
  for (const width of [1120, 375, 320]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.evaluate(`(${legend}).scrollIntoView({block:'center'}); true`);
    await wait(150);
    const geometry = await client.evaluate(`(()=>{const el=(${legend}),r=el.getBoundingClientRect(),footer=el.parentElement,link=footer.querySelector('a[href*=achievements]'),a=link?.getBoundingClientRect();return {left:r.left,right:r.right,overflow:el.scrollWidth>el.clientWidth+1,font:getComputedStyle(el).fontSize,aligned:a&&Math.abs(a.top+a.height/2-r.top-r.height/2)<2,link:!!link}})()`);
    assert.ok(geometry.left >= 0 && geometry.right <= width && !geometry.overflow, mode + ' readable legend at ' + width + ': ' + JSON.stringify(geometry));
    assert.equal(geometry.font, '12px');
    assert.equal(geometry.link, true, 'achievement navigation remains available');
    if (width === 1120) assert.equal(geometry.aligned, true, 'achievement and legend share a baseline');
    await captureSettled(window, path.join(output, `${mode}-heatmap-${width}.png`));
    if (width === 1120) {
      const clip = await client.evaluate(`(()=>{const r=(${legend}).parentElement.parentElement.getBoundingClientRect();return {x:Math.floor(r.left),y:Math.floor(r.top),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
      await writeFile(path.join(output, `${mode}-heatmap-preview.png`), (await window.webContents.capturePage(clip)).toPNG());
    }
    await client.evaluate(`(${help}).focus(); true`);
    await client.key(width === 375 ? ' ' : 'Enter');
    await until(() => client.evaluate(`${dialog}?.innerText.includes('无用量记录')`), mode + ' keyboard legend help ' + width);
    const content = await client.evaluate(`${dialog}.innerText`);
    assert.ok(content.includes('每日用量色阶 · Token') && content.includes('区间随所选 Agent'), 'help leads with daily Token ranges and a short scope note');
    assert.ok(!content.includes('相对') && !content.includes('UTC+8'), 'long explanations start collapsed');
    assert.ok(content.includes('万'), 'real thresholds use the saved localized Token units');
    assert.equal(await client.evaluate(`${dialog}.querySelector('details').open`), false, 'statistics methodology starts collapsed');
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-heatmap-band]').length`), closeBands ? 4 : 2, 'only raw empty bands are omitted');
    const bounds = await client.evaluate(`(()=>{const r=${dialog}.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top,overflow:${dialog}.scrollWidth>${dialog}.clientWidth+1}})()`);
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900 && !bounds.overflow, 'help stays inside the viewport');
    await captureSettled(window, path.join(output, `${mode}-heatmap-help-${width}.png`));
    await client.evaluate(`${dialog}.querySelector('summary').focus(); true`);
    await client.key('Enter');
    await until(() => client.evaluate(`${dialog}.querySelector('details').open && ${dialog}.innerText.includes('相对') && ${dialog}.innerText.includes('UTC+8') && ${dialog}.innerText.includes('也可能尚未采集到记录')`), mode + ' preserved methodology expands by keyboard');
    if (width === 1120) await captureSettled(window, path.join(output, `${mode}-heatmap-help-expanded.png`));
    await client.key(' ');
    await until(() => client.evaluate(`!${dialog}.querySelector('details').open`), 'methodology collapses by keyboard');
    await client.evaluate(`localStorage.setItem('quotern-token-unit-mode','international'); window.dispatchEvent(new StorageEvent('storage',{key:'quotern-token-unit-mode'})); true`);
    await until(() => client.evaluate(`${dialog}?.innerText.includes('1M') && !${dialog}.innerText.includes('万')`), mode + ' open help updates Token units');
    if (closeBands) assert.equal(await client.evaluate(`${dialog}.innerText.includes('约 1M 附近') && !${dialog}.innerText.includes('1M < Token ≤ 1M')`), true, 'rounded boundaries use an approximate label instead of an impossible interval');
    await client.evaluate(`localStorage.setItem('quotern-token-unit-mode','localized'); window.dispatchEvent(new StorageEvent('storage',{key:'quotern-token-unit-mode'})); true`);
    await until(() => client.evaluate(`${dialog}?.innerText.includes('万')`), mode + ' localized units restored');
    await client.key('Escape');
    await until(() => client.evaluate(`!${dialog} && document.activeElement===(${help})`), mode + ' Escape restores legend help focus');
  }
  if (mode === 'browser') {
    await client.click('document.querySelector("button[aria-label=\\"热力图来源：全部 Agent\\"]")');
    await until(() => client.evaluate(`${dialog}?.innerText.includes('仅影响热力图')`), 'heatmap source scope');
    await client.click('[...document.querySelectorAll("[role=dialog] button")].find(el=>el.textContent.trim()==="取消全选")');
    await client.key('Escape');
    await until(() => client.evaluate(`!${dialog} && document.body.innerText.includes('请至少选择一个 Agent')`), 'empty source selection');
    assert.equal(await client.evaluate(`Boolean(document.querySelector('[data-heatmap-footer] a[href*=achievements]'))`), true, 'empty source selection preserves achievement navigation');
    await client.click(help);
    await until(() => client.evaluate(`${dialog}?.innerText.includes('当前没有活跃日')`), 'no activity explanation');
    assert.equal(await client.evaluate('document.querySelectorAll("[data-heatmap-band]").length'), 0, 'no activity has no fabricated Token boundaries');
    await client.key('Escape');
    await client.click('document.querySelector("button[aria-label^=\\"热力图来源：\\"]")');
    await until(() => client.evaluate(`${dialog}?.innerText.includes('仅影响热力图')`), 'restore heatmap sources');
    await client.click('[...document.querySelectorAll("[role=dialog] button")].find(el=>el.textContent.trim()==="全部")');
    await client.key('Escape');
    await until(() => client.evaluate(`!${dialog} && !document.body.innerText.includes('请至少选择一个 Agent')`), 'all sources restored');
  }
  await exerciseHeatmapHelpScrolling(window, client, mode, help, dialog);
  for (const [locale, title, noUsage] of [['en', 'Daily tokens', 'No recorded usage'], ['ja', '1日のトークン使用量', '使用量の記録なし'], ['ko', '일일 토큰 사용량', '기록된 사용량 없음'], ['zh-CN', '每日 Token 用量', '无用量记录']]) {
    if (mode === 'browser') await client.evaluate(`localStorage.setItem('quotern.locale.preference',${JSON.stringify(locale)}); window.dispatchEvent(new StorageEvent('storage',{key:'quotern.locale.preference'})); true`);
    else window.webContents.send('locale:changed', { preference: locale, resolved: locale, systemLocale: 'zh-CN' });
    await until(() => client.evaluate(`(${legend})?.textContent.includes(${JSON.stringify(title)})`), mode + ' translated legend ' + locale);
    await client.click(help);
    await until(() => client.evaluate(`${dialog}?.innerText.includes(${JSON.stringify(noUsage)})`), mode + ' translated help ' + locale);
    assert.equal(await client.evaluate(`${dialog}.innerText.includes('usage.heatmap.')`), false, 'no missing translation keys');
    await client.key('Escape');
    await until(() => client.evaluate(`!${dialog}`), 'close translated help');
  }
  await client.call('Emulation.clearDeviceMetricsOverride');
  await client.evaluate(`document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); document.documentElement.dataset.theme='dark'; (${legend}).scrollIntoView({block:'center'}); true`);
  await captureSettled(window, path.join(output, `${mode}-heatmap-dark.png`));
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  checks.push(mode + '-heatmap-legend-help-keyboard-focus-units-equal-thresholds-wide-narrow-themes');
}

async function main() {
  await mkdir(output, { recursive: true });
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/functions/')) { const result = await api(req.url, { method: req.method }); res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body)); return; }
    const root = path.join(workspace, 'packages/dashboard/dist');
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, ['/', '/dashboard', '/sessions', '/pricing'].includes(pathname) ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' }).end(body); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(browser);
  await browser.loadURL(`http://127.0.0.1:${server.address().port}/${dashboardOnly || heatmapOnly ? 'dashboard' : 'sessions?page=4'}`);
  const browserClient = await connect(browser);
  if (heatmapOnly) await exerciseHeatmapLegend(browser, browserClient, 'browser');
  else if (dashboardOnly) await exerciseDashboardFixes(browser, browserClient, 'browser');
  else { await exercise(browser, browserClient, 'browser'); await exerciseCompactFilters(browser, browserClient, 'browser'); }
  browser.destroy();
  calls.length = 0;
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  registerAppearanceFixture();
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('autostart:get', () => false);
  ipcMain.handle('autostart:get-hidden', () => false);
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('dsh-pet:navigation-get', () => null);
  ipcMain.handle('dsh-pet:navigation-ack', () => {});
  ipcMain.handle('quota:navigation:get', () => null);
  ipcMain.handle('notifications:navigation-get', () => null);
  ipcMain.handle('tud:api-request', (_event, route, init) => api(route, init));
  ipcMain.handle('quota:get', () => ({ providers: [], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null }));
  ipcMain.handle('share-backgrounds:request', (_event, request) => { assert.deepEqual(request, { operation: 'legacy' }); return []; });
  const window = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } }); windows.push(window);
  await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: dashboardOnly || heatmapOnly ? '/dashboard' : '/sessions?page=4' });
  const desktopClient = await connect(window);
  if (heatmapOnly) await exerciseHeatmapLegend(window, desktopClient, 'desktop');
  else if (dashboardOnly) await exerciseDashboardFixes(window, desktopClient, 'desktop');
  else { await exercise(window, desktopClient, 'desktop'); await exerciseCompactFilters(window, desktopClient, 'desktop'); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => { console.error('Session and compact-filter acceptance exceeded 180 seconds'); app.exit(2); }, 180_000);
void app.whenReady().then(main).catch(async error => {
  console.error(error); await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  for (let index = 0; index < clients.length; index++) try { await writeFile(path.join(output, `failure-${index}.txt`), await clients[index].evaluate('document.body.innerText')); } catch {}
  process.exitCode = 1;
}).finally(async () => { for (const client of clients) client.close(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) await new Promise(resolve => server.close(resolve)); clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
