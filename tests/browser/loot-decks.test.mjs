import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { EdgeSession, edge, browserSkipReason } from './edge-session.mjs';
import { bootstrapStyles, startApp } from './app-fixture.mjs';

const numbers = [...Array.from({ length: 10 }, (_, index) => index + 1), 11, 12, 99];
const catalog = {
  decks: [
    { id: 'druid', name: 'Druide', icon: '🌿' },
    ...numbers.map(number => ({ id: `loot-${number}`, name: `Beute ${number}`, icon: `loot:${number}` })),
    { id: 'custom', name: 'Eigenes Deck', icon: 'loot:100' }
  ],
  effectTypes: [
    { id: 'extra-action', name: 'Weitere Aktion', icon: '⚡', hasValue: false },
    { id: 'other', name: 'Sonstige', icon: '✳️', hasValue: true }
  ],
  symbols: [{ id: 'star', name: 'Stern', icon: '★' }]
};
const bootstrap = browserSkipReason ? null : await bootstrapStyles();
const skip = browserSkipReason || (!bootstrap && 'Optional test: run Maven first to download the Bootstrap Webjar, or set MAVEN_REPOSITORY');

test('loot decks render dynamic SVG numbers and survive mobile selection, editing and filtering', { skip, timeout: 30_000 }, async t => {
  const app = await startApp(bootstrap, catalog);
  let browser;
  const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const choose = (selector, value) => browser.evaluate(`(() => { const select = document.querySelector(${JSON.stringify(selector)}); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  try {
    browser = await EdgeSession.launch(edge);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'mediaDevices', { value: { addEventListener() {}, removeEventListener() {}, async getUserMedia() { throw new DOMException('Test camera unavailable', 'NotFoundError'); } } });` });
    await browser.send('Page.navigate', { url: app.url });
    await browser.waitFor(`document.querySelectorAll('#deckButtons button').length === ${catalog.decks.length} && document.querySelector('#cameraStatus').textContent === 'Bereit'`);
    await browser.evaluate(`document.querySelector('#manualQr').value = 'loot://10'; document.querySelector('#manualButton').click(); document.querySelector('#cardName').value = 'Goldfund'; document.querySelector('#cardName').dispatchEvent(new Event('input', { bubbles: true }));`);

    await t.test('one shared SVG supports single and double digit decks including later additions', async () => {
      assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('#deckButtons svg.loot-icon text'), text => text.textContent)`), numbers.map(String));
      for (const number of numbers) {
        const icon = await browser.evaluate(`(() => { const button = document.querySelector('#deckButtons [data-id="loot-${number}"]'); const svg = button.querySelector('svg'); return { label: button.getAttribute('aria-label'), hidden: svg.getAttribute('aria-hidden'), focusable: svg.getAttribute('focusable'), image: svg.querySelector('image').getAttribute('href'), name: button.querySelector('.deck-name').textContent }; })()`);
        assert.deepEqual(icon, { label: `Deck Beute ${number}`, hidden: 'true', focusable: 'false', image: '/icons/loot.svg', name: `Beute ${number}` });
        assert.equal(await browser.evaluate(`document.querySelector('#deckFilter option[value="loot-${number}"]').textContent`), `Beute ${number}`);
      }
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons [data-id="druid"] .icon').textContent`), '🌿');
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons [data-id="custom"] .icon').textContent`), 'loot:100');
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons [data-id="custom"] svg')`), null);
      const asset = await browser.evaluate(`(async () => { const image = new Image(); image.src = '/icons/loot.svg'; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 160, 160); return { cornerAlpha: context.getImageData(0, 0, 1, 1).data[3], centerAlpha: context.getImageData(80, 80, 1, 1).data[3] }; })()`);
      assert.deepEqual(asset, { cornerAlpha: 0, centerAlpha: 255 }, 'The shared SVG must decode with a transparent background and a visible medallion');
      assert.ok(app.resources.has('/icons/loot.svg'), 'All numbered decks load the same local SVG asset');
    });

    await t.test('numbers remain inside the badge at 320 and 375 pixel mobile widths', async () => {
      for (const width of [320, 375]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 1, mobile: true });
        const sizes = await browser.evaluate(`Array.from(document.querySelectorAll('#deckButtons svg.loot-icon'), svg => { const text = svg.querySelector('text').getBBox(); const bounds = svg.getBoundingClientRect(); return { number: svg.querySelector('text').textContent, x: text.x, y: text.y, width: text.width, height: text.height, renderedWidth: bounds.width, renderedHeight: bounds.height }; })`);
        for (const size of sizes) {
          assert.ok(size.x >= 0 && size.y >= 0 && size.x + size.width <= 160 && size.y + size.height <= 160, `Deck ${size.number} must fit inside the SVG view box`);
          assert.ok(size.renderedWidth >= 24 && size.renderedHeight >= 24, `Deck ${size.number} must remain readable on mobile`);
        }
        assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), `The deck grid must fit a ${width} pixel viewport`);
      }
    });

    await t.test('saving and reopening preserves a two digit deck and updates deck name variables', async () => {
      await click('#deckButtons [data-id="loot-10"]');
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons [data-id="loot-10"]').getAttribute('aria-pressed')`), 'true');
      await click('#effectChoices [aria-label="Weitere Aktion hinzufügen"]');
      await choose('#variableReference', 'deckName');
      assert.match(await browser.evaluate(`document.querySelector('#descriptionEditor').textContent`), /Beute 10/);
      if (process.env.BROWSER_SCREENSHOT) {
        const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await mkdir(dirname(resolve(process.env.BROWSER_SCREENSHOT)), { recursive: true });
        await writeFile(process.env.BROWSER_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
      }
      await click('#saveButton');
      await browser.waitFor(`!document.querySelector('#lastSaved').hidden && document.querySelector('#cardFields').disabled`);
      assert.equal(app.writes[0].method, 'POST');
      assert.equal(app.writes[0].payload.deckId, 'loot-10');
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons .selected').dataset.id`), 'loot-10');
      await click('#lastSavedEdit');
      await browser.waitFor(`!document.querySelector('#cardFields').disabled`);
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons .selected').dataset.id`), 'loot-10');
      await click('#deckButtons [data-id="loot-11"]');
      assert.match(await browser.evaluate(`document.querySelector('#descriptionEditor').textContent`), /Beute 11/);
      await click('#saveButton');
      await browser.waitFor(`document.querySelector('#cardFields').disabled && !document.body.classList.contains('saving')`);
      assert.equal(app.writes[1].method, 'PUT');
      assert.equal(app.writes[1].payload.deckId, 'loot-11');
    });

    await t.test('library badges use the same numbered SVG and filtering submits the selected deck', async () => {
      await click('#libraryTab');
      await browser.waitFor(`document.querySelectorAll('#cardList .edit-card').length === 1`);
      assert.equal(await browser.evaluate(`document.querySelector('#cardList .card-tag svg text').textContent`), '11');
      const tags = await browser.evaluate(`document.querySelector('#cardList .card-tags').textContent`);
      assert.match(tags, /Beute 11/);
      assert.ok(!tags.includes('loot:'), 'Internal icon markers must not appear in card tags');
      await choose('#deckFilter', 'loot-10');
      await browser.waitFor(`document.querySelector('#cardList .empty-library') !== null`);
      assert.equal(app.queries.at(-1).get('deckId'), 'loot-10');
      await choose('#deckFilter', 'loot-11');
      await browser.waitFor(`document.querySelectorAll('#cardList .edit-card').length === 1`);
      assert.equal(app.queries.at(-1).get('deckId'), 'loot-11');
      assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'));
      await click('#cardList .edit-card');
      await browser.waitFor(`!document.querySelector('#cardFields').disabled && !document.querySelector('#captureView').hidden`);
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons .selected').dataset.id`), 'loot-11');
      await click('#deckButtons [data-id="loot-99"]');
      assert.equal(await browser.evaluate(`document.querySelector('#deckButtons .selected svg text').textContent`), '99');
      assert.match(await browser.evaluate(`document.querySelector('#descriptionEditor').textContent`), /Beute 99/);
      assert.deepEqual(app.failures, []);
      assert.deepEqual(browser.exceptions, []);
    });
  } finally {
    await browser?.close();
    app.server.closeAllConnections();
    await new Promise((accept, reject) => app.server.close(error => error ? reject(error) : accept()));
  }
});
