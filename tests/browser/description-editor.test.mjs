import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { EdgeSession, edge, browserSkipReason as skip } from './edge-session.mjs';

test('description editor in a real browser', { skip, timeout: 30_000 }, async t => {
  const browser = await EdgeSession.launch(edge);
  try {
    const source = await readFile(new URL('../../src/main/resources/static/js/description-editor.js', import.meta.url), 'utf8');
    await browser.evaluate(`(async () => {
      document.body.innerHTML = '<div id="editor"></div><output id="counter"></output><button id="toolbar">Effekt</button>';
      const { DescriptionEditor } = await import(URL.createObjectURL(new Blob([${JSON.stringify(source)}], { type: 'text/javascript' })));
      window.ctx = { name: 'Karte', cardNumber: '42', deckId: 'warrior', qrValue: 'QR', effects: [{ id: 'effect1', typeId: 'melee', value: 3 }] };
      window.invalid = null;
      window.editor = new DescriptionEditor({ element: document.querySelector('#editor'), counter: document.querySelector('#counter'), catalog: { symbols: [{ id: 'star', name: 'Stern', icon: '★' }], effectTypes: [{ id: 'melee', name: 'Nahkampf', icon: '⚔' }, { id: 'other', name: 'Sonstige', icon: '✱' }], decks: [{ id: 'warrior', name: 'Krieger' }] }, getContext: () => window.ctx, onInvalid: message => { window.invalid = message; } });
    })()`);

    await t.test('toolbar insertion preserves the saved cursor and native spacing', async () => {
      await browser.evaluate("editor.setSegments([{ kind: 'text', text: 'Hallo ' }]); editor.focus(); document.querySelector('#toolbar').focus(); editor.insertEffect('effect1');");
      await browser.type(' jetzt');
      assert.equal(await browser.evaluate('editor.getText()'), 'Hallo Nahkampf 3 jetzt');
    });

    await t.test('effect and card variables follow their current values', async () => {
      await browser.evaluate("ctx.effects[0].value = 7; editor.refreshReferences();");
      assert.equal(await browser.evaluate('editor.getText()'), 'Hallo Nahkampf 7 jetzt');
      await browser.evaluate("editor.setSegments([{ kind: 'variable', variable: 'name' }, { kind: 'text', text: ' / ' }, { kind: 'variable', variable: 'deckName' }]); ctx.name = 'Neue Karte'; editor.refreshReferences();");
      assert.equal(await browser.evaluate('editor.getText()'), 'Neue Karte / Krieger');
    });

    await t.test('native typing stops at 400 Unicode code points and keeps valid content valid', async () => {
      await browser.evaluate("editor.setSegments([{ kind: 'text', text: 'a'.repeat(399) }]); editor.focus();");
      await browser.type('xy');
      const result = await browser.evaluate("({ text: editor.getText(), count: document.querySelector('#counter').textContent, invalid })");
      assert.equal(result.text.length, 400);
      assert.equal(result.count, '400/400');
      assert.equal(result.invalid, null);
    });

    await t.test('paste uses plain text and counts supplementary Unicode characters once', async () => {
      await browser.key('Backspace', 'Backspace', 8);
      await browser.evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', '😀');
        transfer.setData('text/html', '<img src=x onerror=alert(1)>');
        document.querySelector('#editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      })()`);
      const result = await browser.evaluate("({ text: editor.getText(), html: document.querySelector('#editor').innerHTML })");
      assert.equal(Array.from(result.text).length, 400);
      assert.ok(result.text.endsWith('😀'));
      assert.ok(!result.html.includes('<img'));
    });

    await t.test('changes in references mark expanded descriptions above 400 as invalid', async () => {
      await browser.evaluate("ctx.effects[0].value = 3; editor.setSegments([{ kind: 'text', text: 'b'.repeat(388) }, { kind: 'effect', effectId: 'effect1' }]); ctx.effects[0].value = 12345; editor.refreshReferences();");
      const result = await browser.evaluate('({ text: editor.getText(), invalid })');
      assert.equal(Array.from(result.text).length, 402);
      assert.match(result.invalid, /402/);
    });

    await t.test('removing an effect preserves its last text and undo blocks a dangling reference', async () => {
      await browser.evaluate("editor.setSegments([{ kind: 'effect', effectId: 'effect1' }]); ctx.effects = []; editor.removeEffectReferences('effect1');");
      assert.equal(await browser.evaluate('editor.getText()'), 'Nahkampf 12345');
      assert.ok(!(await browser.evaluate('editor.getSegments()')).some(segment => segment.kind === 'effect'));
      await browser.evaluate('editor.focus()');
      await browser.key('z', 'KeyZ', 90, 2);
      assert.ok((await browser.evaluate('editor.getSegments()')).some(segment => segment.kind === 'effect'));
      assert.match(await browser.evaluate('invalid'), /nicht mehr verfügbar/);
    });

    await t.test('native input after a trailing newline and keyboard undo/redo retain line breaks', async () => {
      await browser.evaluate("editor.setSegments([{ kind: 'text', text: 'Zeile 1' }]); editor.focus();");
      await browser.key('Enter', 'Enter', 13);
      await browser.type('Zeile 2');
      assert.equal(await browser.evaluate('editor.getText()'), 'Zeile 1\nZeile 2');
      await browser.key('z', 'KeyZ', 90, 2);
      await browser.key('z', 'KeyZ', 90, 10);
      assert.equal(await browser.evaluate('editor.getText()'), 'Zeile 1\nZeile 2');
    });

    await t.test('custom names are used exclusively for the other effect type', async () => {
      await browser.evaluate("ctx.effects = [{ id: 'effect1', typeId: 'melee', customName: 'POISON_EXPLOSION', value: 3 }]; editor.setSegments([{ kind: 'effect', effectId: 'effect1' }]);");
      assert.equal(await browser.evaluate('editor.getText()'), 'Nahkampf 3');
      await browser.evaluate("ctx.effects[0].typeId = 'other'; editor.refreshReferences();");
      assert.equal(await browser.evaluate('editor.getText()'), 'POISON_EXPLOSION 3');
    });
  } finally { await browser.close(); }
});
