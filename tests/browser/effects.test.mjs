import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { EdgeSession, edge, browserSkipReason } from './edge-session.mjs';
import { bootstrapStyles, startApp } from './app-fixture.mjs';

const addedTypes = [
  { id: 'draw', name: 'Karten ziehen', icon: '🃏', valueLabel: 'Karten', hasValue: true },
  { id: 'heal', name: 'Heilen', icon: '❤️', valueLabel: 'Heilung', hasValue: true },
  { id: 'extra-action', name: 'Weitere Aktion', icon: '⚡', hasValue: false },
  { id: 'poison', name: 'Gift zufügen', icon: '💧', valueLabel: 'Gift', hasValue: true },
  { id: 'direct-damage', name: 'Direkter Schaden', icon: '💔', valueLabel: 'Schaden', hasValue: true }
];
const catalog = {
  decks: [
    { id: 'druid', name: 'Druide', icon: '🌿' },
    { id: 'halfling', name: 'Halbling', icon: '🍀' },
    { id: 'dwarf', name: 'Zwerg', icon: '🔨' },
    { id: 'elf', name: 'Elfe', icon: '🧝' },
    { id: 'warrior', name: 'Krieger', icon: '🛡️' },
    { id: 'troll', name: 'Troll', icon: '👹' },
    { id: 'shaman', name: 'Schamane', icon: '🪶' },
    { id: 'rogue', name: 'Schurke', icon: '🗡️' },
    { id: 'mage', name: 'Magier', icon: '🪄' },
    { id: 'items', name: 'Gegenstände', icon: '🎒' }
  ],
  effectTypes: [
    { id: 'melee', name: 'Nahkampf', icon: '⚔️', valueLabel: 'Schaden' },
    { id: 'melee-boost', name: 'Nahkampf-Verstärkung', icon: '⚔️⁺', valueLabel: 'Verstärkung' },
    { id: 'ranged', name: 'Fernkampf', icon: '🏹', valueLabel: 'Schaden' },
    { id: 'ranged-boost', name: 'Fernkampf-Verstärkung', icon: '🏹⁺', valueLabel: 'Verstärkung' },
    ...addedTypes,
    { id: 'other', name: 'Sonstige', icon: '✳️', valueLabel: 'Wert (optional)' }
  ],
  symbols: [
    { id: 'sword', name: 'Schwert', icon: '⚔️' },
    { id: 'shield', name: 'Schild', icon: '🛡️' },
    { id: 'fire', name: 'Feuer', icon: '🔥' },
    { id: 'heart', name: 'Herz', icon: '❤️' },
    { id: 'lightning', name: 'Blitz', icon: '⚡' },
    { id: 'star', name: 'Stern', icon: '★' },
    { id: 'card-draw', name: 'Karten ziehen', icon: '🃏' },
    { id: 'poison', name: 'Gift', icon: '💧' },
    { id: 'broken-heart', name: 'Gebrochenes Herz', icon: '💔' }
  ]
};

const bootstrap = browserSkipReason ? null : await bootstrapStyles();
const skip = browserSkipReason || (!bootstrap && 'Optional test: run Maven first to download the Bootstrap Webjar, or set MAVEN_REPOSITORY');

test('card sources persist per card and the next-card preference survives reloads and editing', { skip, timeout: 30_000 }, async () => {
  const app = await startApp(bootstrap, catalog);
  let browser;
  const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const source = () => browser.evaluate(`document.querySelector('#sourceId').value`);
  const choose = value => browser.evaluate(`(() => { const select = document.querySelector('#sourceId'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const begin = qr => browser.evaluate(`(() => { document.querySelector('#manualQr').value = ${JSON.stringify(qr)}; document.querySelector('#manualButton').click(); })()`);
  const reload = async () => {
    await browser.send('Page.navigate', { url: app.url });
    await browser.waitFor(`document.querySelectorAll('#effectChoices button').length === 10 && document.querySelector('#cameraStatus').textContent === 'Bereit'`);
  };
  try {
    browser = await EdgeSession.launch(edge);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'mediaDevices', { value: { addEventListener() {}, removeEventListener() {}, async getUserMedia() { throw new DOMException('Test camera unavailable', 'NotFoundError'); } } });` });
    await reload();
    await begin('source://jungle');
    assert.equal(await browser.evaluate(`document.querySelector('#cardNumber')`), null);
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'cardName');
    assert.equal(await source(), 'base-game');
    assert.deepEqual(await browser.evaluate(`Array.from(document.querySelector('#sourceId').options, option => option.textContent)`), ['Basisspiel', 'Promo', 'Jungle Fever (Erweiterung)']);
    await choose('jungle-fever');
    await browser.evaluate(`document.querySelector('#cardName').value = 'Dschungelkarte';`);
    assert.equal(await browser.evaluate(`document.querySelector('#deckButtons [data-id="items"]').getAttribute('aria-label')`), 'Deck Gegenstände');
    assert.equal(await browser.evaluate(`document.querySelector('#deckFilter option[value="items"]').textContent`), 'Gegenstände');
    await click('#deckButtons [data-id="items"]');
    await click('#effectChoices [aria-label="Weitere Aktion hinzufügen"]');
    assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    await click('#saveButton');
    await browser.waitFor(`!document.querySelector('#lastSaved').hidden && document.querySelector('#cardFields').disabled`);
    assert.equal(app.writes[0].payload.sourceId, 'jungle-fever');
    assert.equal(app.writes[0].payload.deckId, 'items');
    assert.equal(Object.hasOwn(app.writes[0].payload, 'cardNumber'), false);
    await begin('source://next');
    assert.equal(await source(), 'jungle-fever');
    assert.equal(await browser.evaluate(`document.querySelector('#deckButtons [data-id="items"]').getAttribute('aria-pressed')`), 'true');
    await choose('promo');
    await browser.evaluate(`window.confirm = () => true;`);
    await click('#discardButton');
    await begin('source://after-discard');
    assert.equal(await source(), 'promo');
    await reload();
    await begin('source://after-reload');
    assert.equal(await source(), 'promo');
    await click('#libraryTab');
    await browser.waitFor(`document.querySelectorAll('#cardList .edit-card').length === 1`);
    assert.match(await browser.evaluate(`document.querySelector('#cardList').textContent`), /Jungle Fever \(Erweiterung\)/);
    await click('#cardList .edit-card');
    await browser.waitFor(`document.querySelector('#cardName').value === 'Dschungelkarte'`);
    assert.equal(await source(), 'jungle-fever');
    await click('#saveButton');
    await browser.waitFor(`document.querySelector('#cardFields').disabled && !document.body.classList.contains('saving')`);
    assert.equal(app.writes[1].payload.sourceId, 'jungle-fever');
    await begin('source://after-edit');
    assert.equal(await source(), 'promo');
    await choose('base-game');
    await browser.evaluate(`window.confirm = () => true;`);
    await click('#discardButton');
    await click('#lastSavedEdit');
    await browser.waitFor(`document.querySelector('#cardName').value === 'Dschungelkarte'`);
    await choose('promo');
    await click('#saveButton');
    await browser.waitFor(`document.querySelector('#cardFields').disabled && !document.body.classList.contains('saving')`);
    assert.equal(app.writes[2].payload.sourceId, 'promo');
    assert.deepEqual(app.failures, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    app.server.closeAllConnections();
    await new Promise((accept, reject) => app.server.close(error => error ? reject(error) : accept()));
  }
});

test('new effects survive mobile editing and persistence in a real browser', { skip, timeout: 30_000 }, async t => {
  const app = await startApp(bootstrap, catalog);
  let browser;
  const choose = async (selector, value) => browser.evaluate(`(() => { const select = document.querySelector(${JSON.stringify(selector)}); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const fill = async (selector, value) => {
    await browser.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); })()`);
    if (String(value)) await browser.type(String(value));
    else await browser.key('Backspace', 'Backspace', 8);
  };
  const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const rows = () => browser.evaluate(`Array.from(document.querySelectorAll('#effectRows .effect-row'), row => ({ typeId: row.querySelector('select').value, value: row.querySelector('.effect-value')?.value ?? null }))`);
  const references = () => browser.evaluate(`Array.from(document.querySelectorAll('#descriptionEditor [data-kind="effect"]'), token => token.textContent)`);
  try {
    browser = await EdgeSession.launch(edge);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'mediaDevices', { value: { addEventListener() {}, removeEventListener() {}, async getUserMedia() { throw new DOMException('No camera in the effects UI test', 'NotFoundError'); } } });` });
    await browser.send('Page.navigate', { url: app.url });
    await browser.waitFor(`document.querySelectorAll('#effectChoices button').length === 10 && document.querySelector('#cameraStatus').textContent === 'Bereit'`);
    await browser.evaluate(`document.querySelector('#manualDetails').open = true;`);
    await fill('#manualQr', 'effects-mobile-qr');
    await click('#manualButton');
    await fill('#cardName', 'Neue Effekte');
    await click('#deckButtons [data-id="warrior"]');

    await t.test('all five effects expose their appropriate value controls and labels', async () => {
      for (const type of addedTypes) await click(`#effectChoices [aria-label="${type.name} hinzufügen"]`);
      for (const [index, value] of [[0, 2], [1, 3], [3, 4], [4, 5]]) await fill(`#effectRows .effect-row:nth-child(${index + 1}) .effect-value`, value);
      assert.deepEqual(await rows(), [
        { typeId: 'draw', value: '2' },
        { typeId: 'heal', value: '3' },
        { typeId: 'extra-action', value: null },
        { typeId: 'poison', value: '4' },
        { typeId: 'direct-damage', value: '5' }
      ]);
      assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('#effectRows .effect-value'), input => input.getAttribute('aria-label'))`), ['Karten von Effekt 1', 'Heilung von Effekt 2', 'Gift von Effekt 4', 'Schaden von Effekt 5']);
      const effectIds = await browser.evaluate(`Array.from(document.querySelectorAll('#effectRows .effect-row'), row => row.dataset.id)`);
      assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('#descriptionEditor [data-kind="effect"]'), token => token.dataset.effectId)`), effectIds);
      assert.deepEqual(await references(), ['Karten ziehen 2', 'Heilen 3', 'Weitere Aktion', 'Gift zufügen 4', 'Direkter Schaden 5']);
      assert.equal(await browser.evaluate(`document.querySelector('#descriptionEditor').textContent`), 'Karten ziehen 2\nHeilen 3\nWeitere Aktion\nGift zufügen 4\nDirekter Schaden 5');
      const tops = await browser.evaluate(`Array.from(document.querySelectorAll('#descriptionEditor [data-kind="effect"]'), token => token.getBoundingClientRect().top)`);
      assert.ok(tops.every((top, index) => index === 0 || top > tops[index - 1]), 'Each effect reference must occupy a separate visible line');
      assert.equal(await browser.evaluate('document.activeElement.classList.contains("effect-value")'), true);
    });

    await t.test('moving effects in either direction also moves their description references', async () => {
      await click('#effectRows .effect-row:first-child [aria-label="Effekt 1 nach unten"]');
      assert.deepEqual((await rows()).map(effect => effect.typeId), ['heal', 'draw', 'extra-action', 'poison', 'direct-damage']);
      assert.deepEqual(await references(), ['Heilen 3', 'Karten ziehen 2', 'Weitere Aktion', 'Gift zufügen 4', 'Direkter Schaden 5']);
      await click('#effectRows .effect-row:nth-child(2) [aria-label="Effekt 2 nach oben"]');
      assert.deepEqual((await rows()).map(effect => effect.typeId), addedTypes.map(type => type.id));
      assert.deepEqual(await references(), ['Karten ziehen 2', 'Heilen 3', 'Weitere Aktion', 'Gift zufügen 4', 'Direkter Schaden 5']);
    });

    await t.test('switching between numeric effects and further actions refreshes references and clears stale numbers', async () => {
      await choose('#effectRows .effect-row:first-child select', 'extra-action');
      assert.deepEqual((await rows())[0], { typeId: 'extra-action', value: null });
      assert.equal((await references())[0], 'Weitere Aktion');
      await choose('#effectRows .effect-row:first-child select', 'draw');
      assert.deepEqual((await rows())[0], { typeId: 'draw', value: '0' });
      assert.equal((await references())[0], 'Karten ziehen 0');
      await fill('#effectRows .effect-row:first-child .effect-value', 9);
      assert.equal((await references())[0], 'Karten ziehen 9');
      assert.equal(await browser.evaluate(`document.querySelector('#effectReference option:nth-child(2)').textContent`), 'Karten ziehen 9');
    });

    await t.test('legacy numeric effects and optional custom values continue to work', async () => {
      await click('#effectChoices [aria-label="Nahkampf hinzufügen"]');
      assert.deepEqual((await rows()).at(-1), { typeId: 'melee', value: '0' });
      await choose('#effectRows .effect-row:last-child select', 'other');
      await fill('#effectRows .effect-row:last-child .effect-name', 'BONUS');
      await fill('#effectRows .effect-row:last-child .effect-value', '');
      assert.equal((await rows()).at(-1).value, '');
      const id = await browser.evaluate(`document.querySelector('#effectRows .effect-row:last-child').dataset.id`);
      await choose('#effectReference', id);
      assert.equal((await references()).filter(text => text === 'BONUS').length, 2);
      await click('#effectRows .effect-row:last-child [aria-label="Effekt 6 entfernen"]');
      assert.deepEqual(await references(), ['Karten ziehen 9', 'Heilen 3', 'Weitere Aktion', 'Gift zufügen 4', 'Direkter Schaden 5']);
      assert.equal(await browser.evaluate(`document.querySelector('#descriptionEditor').textContent.includes('BONUS')`), false);
    });

    await t.test('symbols and green poison drops fit a 375 pixel mobile viewport', async () => {
      assert.equal(await browser.evaluate(`document.querySelectorAll('#symbolButtons button').length`), 9);
      for (const name of ['Karten ziehen', 'Herz', 'Blitz', 'Gift', 'Gebrochenes Herz']) await click(`#symbolButtons [aria-label="${name} einfügen"]`);
      assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('#descriptionEditor [data-kind="symbol"]'), token => token.dataset.symbolId)`), ['card-draw', 'heart', 'lightning', 'poison', 'broken-heart']);
      const styles = await browser.evaluate(`Array.from(document.querySelectorAll('.poison-icon'), icon => { const style = getComputedStyle(icon); return { text: icon.textContent, background: style.backgroundImage, width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height }; })`);
      assert.equal(styles.length, 4);
      for (const style of styles) {
        assert.equal(style.text, '💧');
        assert.match(style.background, /\/icons\/poison\.svg/);
        assert.ok(style.width > 0 && style.height > 0);
      }
      assert.equal(await browser.evaluate('innerWidth'), 375);
      assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'The effect toolbar and editor must not overflow horizontally');
      assert.ok(app.resources.has('/icons/poison.svg'), 'The green drop asset is loaded from the application');
      if (process.env.BROWSER_SCREENSHOT) {
        const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await mkdir(dirname(resolve(process.env.BROWSER_SCREENSHOT)), { recursive: true });
        await writeFile(process.env.BROWSER_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
      }
    });

    await t.test('saving and reopening preserves all effects and structured description segments', async () => {
      await click('#saveButton');
      await browser.waitFor(`!document.querySelector('#lastSaved').hidden && document.querySelector('#saveButton').disabled`);
      assert.equal(app.writes.length, 1);
      const payload = app.writes[0].payload;
      assert.equal(app.writes[0].method, 'POST');
      assert.deepEqual(payload.effects.map(({ typeId, value }) => ({ typeId, value })), [
        { typeId: 'draw', value: 9 },
        { typeId: 'heal', value: 3 },
        { typeId: 'extra-action', value: null },
        { typeId: 'poison', value: 4 },
        { typeId: 'direct-damage', value: 5 }
      ]);
      assert.deepEqual(payload.description.filter(segment => segment.kind === 'effect').map(segment => segment.effectId), payload.effects.map(effect => effect.id));
      assert.deepEqual(payload.description.filter(segment => segment.kind === 'symbol').map(segment => segment.symbolId), ['card-draw', 'heart', 'lightning', 'poison', 'broken-heart']);
      await click('#lastSavedEdit');
      await browser.waitFor(`document.querySelectorAll('#effectRows .effect-row').length === 5 && !document.querySelector('#cardFields').disabled`);
      assert.equal(await browser.evaluate(`document.querySelector('#cardName').value`), 'Neue Effekte');
      assert.deepEqual((await rows()).map(effect => effect.typeId), addedTypes.map(type => type.id));
      assert.deepEqual(await references(), ['Karten ziehen 9', 'Heilen 3', 'Weitere Aktion', 'Gift zufügen 4', 'Direkter Schaden 5']);
      await fill('#effectRows .effect-row:nth-child(4) .effect-value', 6);
      assert.equal((await references())[3], 'Gift zufügen 6');
      await click('#effectRows .effect-row:nth-child(4) [aria-label="Effekt 4 nach oben"]');
      assert.deepEqual(await references(), ['Karten ziehen 9', 'Heilen 3', 'Gift zufügen 6', 'Weitere Aktion', 'Direkter Schaden 5']);
      await click('#saveButton');
      await browser.waitFor(`document.querySelector('#cardFields').disabled && !document.body.classList.contains('saving')`);
      assert.equal(app.writes.length, 2);
      assert.equal(app.writes[1].method, 'PUT');
      assert.equal(app.writes[1].payload.effects[2].value, 6);
      assert.equal(app.writes[1].payload.effects[3].value, null);
      assert.deepEqual(app.writes[1].payload.description.filter(segment => segment.kind === 'effect').map(segment => segment.effectId), app.writes[1].payload.effects.map(effect => effect.id));
      assert.equal(app.writes[1].payload.version, 0);
      await click('#lastSavedEdit');
      await browser.waitFor(`!document.querySelector('#cardFields').disabled`);
      assert.deepEqual((await rows()).map(effect => effect.typeId), ['draw', 'heal', 'poison', 'extra-action', 'direct-damage']);
      assert.deepEqual(await references(), ['Karten ziehen 9', 'Heilen 3', 'Gift zufügen 6', 'Weitere Aktion', 'Direkter Schaden 5']);
      assert.deepEqual(app.failures, []);
      assert.deepEqual(browser.exceptions, [], 'The application must not throw unhandled browser errors');
    });
  } finally {
    await browser?.close();
    app.server.closeAllConnections();
    await new Promise((accept, reject) => app.server.close(error => error ? reject(error) : accept()));
  }
});
