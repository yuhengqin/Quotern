// Built HTTP and IPC renderer acceptance against real Core query routes and synthetic metadata.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createLocalApiApp, BucketStore } from '../../../packages/core/dist/index.js';
import { buildAchievementFacts } from '../../../packages/core/dist/achievements/facts.js';
import { evaluateAchievements } from '../../../packages/core/dist/achievements/evaluate.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../../../packages/core/dist/quota/shared/quota.js';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? path.join(workspace, `.quotern-dev/session-pagination-ui-${Date.now()}-${process.pid}`));
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
const facts = buildAchievementFacts([], [], [], new Date(referenceTime));
const demo = { schemaVersion: 1, readOnly: true, referenceTime, exportedAt: referenceTime, collectSince: '2026-10-01T00:00:00Z', lastSyncAt: referenceTime, buckets: [], pricing: { builtin: { exact: {} }, overlay: null },
  history: { messages, observations, timingEvents: [], evidence, titles, codexParents: [], missingSources: [] },
  achievements: { ...evaluateAchievements(facts), earned: [], preferences: { showcaseIds: [], celebrationsEnabled: false }, unreadIds: [], coverage: { fromDate: '2026-10-01', asOfDate: '2026-10-25', timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: [] } } };
const hono = createLocalApiApp({ dataDir: path.join(output, 'must-not-create'), bucketStore, demo, getConfig: () => ({ deviceId: 'fixture', statsSince: demo.collectSince, localCollectSince: demo.collectSince }) });
const calls = [], clients = [], windows = [], checks = [];
let failurePage = 0, server;
async function api(route, init = {}) {
  const url = new URL(route, 'http://localhost');
  calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
  // Opening the ordinary dashboard asks to ensure its collection range. Keep
  // this synthetic, read-only fixture in place instead of starting collection.
  if (url.pathname === '/functions/tud-ensure-local-range') return { status: 200, body: { success: true, message: 'ok', data: { expanded: false, localCollectSince: demo.collectSince, statsSince: demo.collectSince, sync: null, message: 'fixture' } } };
  if (url.pathname === '/functions/tud-session-list' && Number(url.searchParams.get('page')) === failurePage) return { status: 500, body: { success: false, message: 'FIXTURE_PAGE_FAILURE', data: null } };
  const response = await hono.request(route, init);
  return { status: response.status, body: await response.json() };
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
  await browser.loadURL(`http://127.0.0.1:${server.address().port}/sessions?page=4`);
  const browserClient = await connect(browser);
  await exercise(browser, browserClient, 'browser');
  await exerciseCompactFilters(browser, browserClient, 'browser'); browser.destroy();
  calls.length = 0;
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('dsh-pet:navigation-get', () => null);
  ipcMain.handle('dsh-pet:navigation-ack', () => {});
  ipcMain.handle('tud:api-request', (_event, route, init) => api(route, init));
  ipcMain.handle('quota:get', () => ({ providers: [], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null }));
  ipcMain.handle('share-backgrounds:request', (_event, request) => { assert.deepEqual(request, { operation: 'legacy' }); return []; });
  const window = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } }); windows.push(window);
  await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/sessions?page=4' });
  const desktopClient = await connect(window);
  await exercise(window, desktopClient, 'desktop');
  await exerciseCompactFilters(window, desktopClient, 'desktop');
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => { console.error('Session and compact-filter acceptance exceeded 180 seconds'); app.exit(2); }, 180_000);
void app.whenReady().then(main).catch(async error => {
  console.error(error); await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  for (let index = 0; index < clients.length; index++) try { await writeFile(path.join(output, `failure-${index}.txt`), await clients[index].evaluate('document.body.innerText')); } catch {}
  process.exitCode = 1;
}).finally(async () => { for (const client of clients) client.close(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) await new Promise(resolve => server.close(resolve)); clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
