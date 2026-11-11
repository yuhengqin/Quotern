import assert from 'node:assert/strict';

/** Uses only the fixture runtime and real pointer/keyboard events, never live user preferences. */
export async function exerciseQuotaLayout({ client, window, mode, quota, publish, failNextSave, until, shot }) {
  const saved = { providers: quota.providers, preferences: quota.preferences };
  const original = quota.providers[0], a = 'layout-codex', b = 'layout-cursor', c = 'layout-research';
  const copy = (id, label, providerId = 'codex') => ({ ...structuredClone(original), id, label, providerId, profileLabel: undefined,
    provenance: { ...original.provenance, accountRef: `synthetic-${id}` } });
  const states = ['layout-claude', 'layout-gemini', 'layout-zcode', 'layout-antigravity'];
  const initial = [a, b, c, ...states];
  quota.providers = [copy(a, 'Codex'), copy(b, 'Cursor', 'cursor'), copy(c, 'Codex · 研究用账号名称'),
    ...states.map((id, index) => ({ ...copy(id, ['Claude', 'Gemini CLI', 'ZCode', 'Antigravity'][index], ['claude', 'gemini', 'zcode', 'antigravity'][index]), windows: [], details: [], resetCredits: null, status: 'expired', planLabel: null }))];
  quota.preferences = { ...saved.preferences, providerOrder: ['temporarily-hidden', ...initial], compact: false };
  const textButton = text => `[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
  const item = id => `document.querySelector('[data-quota-layout-item="${id}"]')`;
  const handle = id => `${item(id)}.querySelector('[data-quota-drag-handle]')`;
  const order = () => client.evaluate('[...document.querySelectorAll("[data-quota-layout-item]")].map(el=>el.dataset.quotaLayoutItem)');
  const expectOrder = async ids => { const expected = [...ids, ...states.filter(id => !ids.includes(id))]; await until(async () => JSON.stringify(await order()) === JSON.stringify(expected), mode + ' order ' + expected.join(',')); };
  const noDetails = async () => assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'arranging never opens card details');
  const start = async () => {
    await client.click(textButton('编辑布局'));
    await until(() => client.evaluate(`document.querySelectorAll("[data-quota-drag-handle]").length === ${initial.length} && document.activeElement?.hasAttribute("data-quota-drag-handle")`), mode + ' arrangement mode and entry focus');
  };
  const menuMove = async (id, label) => { await client.click(`${item(id)}.querySelector('button[aria-label^="移动"]')`); await client.click(textButton(label)); await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'move menu closes'); };
  const reload = async () => { await window.loadURL(window.webContents.getURL()); await until(() => client.evaluate(`document.querySelectorAll("[data-quota-layout-item]").length === ${initial.length}`), mode + ' layout loaded'); };
  try {
    publish(); await reload(); await expectOrder(initial);
    await client.click(`${item(states[3])}.querySelector('[data-quota-card]')`);
    await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'status details open before a sibling changes type');
    const changingStatus = quota.providers.find(provider => provider.id === states[1]);
    changingStatus.windows = structuredClone(original.windows); changingStatus.resetCredits = 2; publish();
    await client.evaluate('window.dispatchEvent(new Event("focus")); true');
    await until(() => client.evaluate(`${item(states[1])}?.querySelectorAll('[role=progressbar]').length === 2`), 'another status item becomes an allowance');
    assert.equal(await client.evaluate('document.querySelectorAll("[role=dialog]").length'), 1, 'a sibling receiving an allowance does not unmount the open status details');
    changingStatus.windows = []; changingStatus.resetCredits = null; publish();
    await client.evaluate('window.dispatchEvent(new Event("focus")); true');
    await until(() => client.evaluate(`${item(states[1])}?.hasAttribute('data-status-row')`), 'status grouping returns');
    assert.equal(await client.evaluate('document.querySelectorAll("[role=dialog]").length'), 1, 'merging status groups preserves open details');
    await client.key('Escape');
    await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'status details close');
    await start();
    await until(() => client.evaluate('document.activeElement?.hasAttribute("data-quota-drag-handle")'), 'entering arrangement gives keyboard focus a useful target');
    await client.click(handle(a));
    await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'clicking the grip still opens its move menu');
    await client.key('Escape');
    await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'grip move menu closes');
    await client.click(`${item(a)}.querySelector('[role=progressbar]')`); await noDetails();
    await menuMove(c, '移到最前'); await expectOrder([c, a, b]);
    assert.deepEqual(quota.preferences.providerOrder, ['temporarily-hidden', ...initial], 'menu move is only a draft');
    await client.click('document.querySelector("section[aria-label=订阅额度] label")');
    assert.equal(quota.preferences.compact, false, 'compact is also only a draft');
    await client.click(textButton('取消')); await expectOrder(initial);
    await until(() => client.evaluate('document.activeElement?.textContent === "编辑布局"'), 'cancel restores entry focus');

    await start(); await menuMove(c, '移到最前'); await expectOrder([c, a, b]);
    quota.providers[0].windows[0].usedPercent = 33; publish();
    await expectOrder([c, a, b]);
    await client.click('document.querySelector("section[aria-label=订阅额度] label")');
    failNextSave(); await client.click(textButton('完成'));
    await until(() => client.evaluate('Boolean([...document.querySelectorAll("[role=alert]")].find(el=>el.textContent.includes("排列保存失败")))'), 'failed save retains a retry');
    await expectOrder([c, a, b]); assert.equal(quota.preferences.compact, false);
    await shot(client, `${mode}-layout-save-failure`);
    await client.click(textButton('重试保存'));
    await until(() => client.evaluate('!document.querySelector("[data-quota-drag-handle]")'), 'save exits arrangement');
    assert.deepEqual(quota.preferences.providerOrder, ['temporarily-hidden', c, a, b, ...states], 'saving preserves invisible identities');
    assert.equal(quota.preferences.compact, true); await reload(); await expectOrder([c, a, b]);

    await start();
    await client.evaluate(`${handle(b)}.focus(); true`); await client.key('Home'); await expectOrder([b, c, a]);
    await until(() => client.evaluate(`document.activeElement?.closest("[data-quota-layout-item]")?.dataset.quotaLayoutItem === ${JSON.stringify(b)}`), 'keyboard move retains source focus');
    await menuMove(b, '下移'); await expectOrder([c, b, a]);
    await menuMove(a, '上移'); await expectOrder([c, a, b]);

    const points = async (source, target, after = false) => {
      await client.evaluate(`${item(source)}.scrollIntoView({block:'center'}); true`);
      return client.evaluate(`(() => { const source=${item(source)}, destination=${item(target)}, from=source.querySelector('[data-quota-card]').getBoundingClientRect(), to=destination.getBoundingClientRect(), vertical=destination.hasAttribute('data-status-row'); return {from:{x:from.left+from.width/2,y:from.top+from.height*.65},to:{x:vertical ? to.left+to.width/2 : to.left+${after ? 'to.width-8' : '8'},y:vertical ? to.top+${after ? 'to.height-8' : '8'} : to.top+to.height/2}}; })()`);
    };
    const press = async point => client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    const move = async point => client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1 });
    const release = async point => client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    let p = await points(b, c);
    await press(p.from); await move({ x: p.from.x + 10, y: p.from.y }); await move(p.to);
    await until(() => client.evaluate('Boolean(document.querySelector("[data-quota-drop-indicator]"))'), 'explicit drop indicator');
    await shot(client, `${mode}-layout-drag-indicator`);
    await release(p.to); await expectOrder([b, c, a]); await noDetails();
    p = await points(a, b);
    await press(p.from); await move(p.to); await client.key('Escape'); await release(p.to);
    await expectOrder([b, c, a]); await noDetails();
    assert.equal(await client.evaluate('document.documentElement.hasAttribute("data-quota-dragging")'), false, 'Escape cleans up drag state');
    await client.click(textButton('取消')); await expectOrder([c, a, b]);

    await client.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    await start();
    await client.evaluate(`${item(c)}.scrollIntoView({block:'start'}); true`);
    await shot(client, `${mode}-layout-narrow`);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'narrow arrangement does not overflow');
    const touch = await client.evaluate(`(() => { const from=${item(c)}.querySelector('[data-quota-card]').getBoundingClientRect(), to=${item(b)}.getBoundingClientRect(); return {from:{x:from.left+from.width/2,y:from.top+from.height*.65},to:{x:to.left+to.width/2,y:to.bottom-8}}; })()`);
    await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch.from, id: 1 }] });
    await client.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch.to, id: 1 }] });
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectOrder([a, b, c]); await noDetails();
    await client.click(textButton('取消'));
    await client.call('Emulation.clearDeviceMetricsOverride');
    await client.click(`${item(c)}.querySelector('[data-quota-card]')`);
    await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'normal details still work');
    await client.key('Escape');
    await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'details close');

    await start(); await menuMove(b, '移到最前'); await expectOrder([b, c, a]);
    const temporarilyAbsent = quota.providers.find(provider => provider.id === b);
    quota.providers = quota.providers.filter(provider => provider.id !== b); publish();
    await client.evaluate('window.dispatchEvent(new Event("focus")); true');
    await until(() => client.evaluate(`document.querySelectorAll("[data-quota-layout-item]").length === ${initial.length - 1}`), 'background update hides an account');
    await client.click(textButton('完成'));
    await until(() => client.evaluate('!document.querySelector("[data-quota-drag-handle]")'), 'save after an account disappears');
    assert.deepEqual(quota.preferences.providerOrder, ['temporarily-hidden', b, c, a, ...states], 'save retains the draft position of an account hidden by a background update');
    quota.providers.splice(1, 0, temporarilyAbsent); publish();
    await reload(); await expectOrder([b, c, a]);

    await start();
    p = await points(states[3], states[1]);
    await press(p.from); await move(p.to); await release(p.to);
    await expectOrder([b, c, a, states[0], states[3], states[1], states[2]]);
    p = await points(states[3], b);
    await press(p.from); await move(p.to); await release(p.to);
    await expectOrder([states[3], b, c, a, states[0], states[1], states[2]]); await noDetails();
    await until(() => client.evaluate(`document.activeElement?.closest('[data-quota-layout-item]')?.dataset.quotaLayoutItem === ${JSON.stringify(states[3])}`), 'cross-group drag restores the moved status row focus');
    await shot(client, `${mode}-layout-status-cross-group`);
    await client.click(textButton('完成'));
    await until(() => client.evaluate('!document.querySelector("[data-quota-drag-handle]")'), 'mixed order saved');
    await reload(); await expectOrder([states[3], b, c, a, states[0], states[1], states[2]]);
    await client.click(`${item(states[3])}.querySelector('[data-quota-card]')`);
    await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'status row details remain accessible after moving');
    await client.key('Escape');
    assert.deepEqual(client.errors, [], 'no runtime exceptions during layout interactions');
  } finally {
    await client.call('Emulation.clearDeviceMetricsOverride');
    quota.providers = saved.providers; quota.preferences = saved.preferences; publish();
  }
}
