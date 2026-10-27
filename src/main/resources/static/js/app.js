import { QrScanner } from './scanner.js';
import { DescriptionEditor } from './description-editor.js';

const $ = id => document.getElementById(id);
const state = { catalog: null, active: false, card: null, effects: [], deckId: '', qrValue: '', dirty: false, saving: false, camera: 'stopped', session: 0, lastSaved: null, descriptionInvalid: null, page: 0, totalPages: 0, listRequest: 0, editingRequest: 0, effectNameRequest: 0 };
let editor;
let searchTimer;
let nameTimer;
let preferredSource = 'base-game';

function rememberedSource() {
  try { preferredSource = localStorage.getItem('bossqr.sourceId') || preferredSource; } catch { }
  return Array.from($('sourceId').options).some(option => option.value === preferredSource) ? preferredSource : 'base-game';
}

function sourceLabel(sourceId) {
  return Array.from($('sourceId').options).find(option => option.value === sourceId)?.textContent || 'Basisspiel';
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(className, text, action, label) {
  const element = node('button', className, text);
  element.type = 'button';
  if (label) element.setAttribute('aria-label', label);
  element.addEventListener('click', action);
  return element;
}

function catalogIcon(item) {
  const icon = node('span', 'icon catalog-icon', item?.icon || '');
  if (item?.id === 'poison' && item.icon === '💧') icon.classList.add('poison-icon');
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function deckIcon(deck) {
  if ([
    'druid', 'dryad', 'goblin', 'paladin', 'hill-halfling', 'copper-dwarf',
    'forest-elf', 'warrior', 'jungle-troll', 'shaman', 'rogue', 'mage'
  ].includes(deck?.icon)) {
    const icon = node('img', 'icon deck-image');
    icon.src = `/icons/${deck.icon}.svg`;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
  const lootNumber = /^loot:([1-9][0-9]?)$/.exec(deck?.icon || '')?.[1];
  if (!lootNumber) return catalogIcon(deck);
  const svgElement = (tag, attributes) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  };
  const icon = svgElement('svg', { class: 'icon loot-icon', viewBox: '0 0 160 160', 'aria-hidden': 'true', focusable: 'false' });
  const number = svgElement('text', { x: '80', y: '108', 'text-anchor': 'middle', 'font-family': 'Georgia, "Times New Roman", serif', 'font-size': lootNumber.length === 1 ? '88' : '80', 'font-weight': '700', 'letter-spacing': lootNumber.length === 1 ? '0' : '-5', fill: '#211b12' });
  number.textContent = lootNumber;
  icon.append(svgElement('image', { href: '/icons/loot.svg', width: '160', height: '160' }), number);
  return icon;
}

function hasEffectValue(typeId) {
  return state.catalog.effectTypes.find(type => type.id === typeId)?.hasValue !== false;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    throw new Error('Der Server ist nicht erreichbar. Deine Eingaben bleiben erhalten.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || 'Die Anfrage konnte nicht verarbeitet werden.'), data, { status: response.status });
  return data;
}

function notify(message, error = false, action) {
  const notice = $('notice');
  notice.replaceChildren(node('span', 'notice-message', message));
  notice.classList.toggle('error', error);
  notice.hidden = false;
  if (action) notice.append(button('text-button', action.text, action.run));
  notice.append(button('text-button', '×', () => { notice.hidden = true; }, 'Meldung schließen'));
}

function clearErrors() {
  document.querySelectorAll('[data-error]').forEach(element => { element.textContent = ''; });
  document.querySelectorAll('.is-invalid').forEach(element => element.classList.remove('is-invalid'));
}

function fieldError(field, message) {
  const key = field.startsWith('effects') ? 'effects' : field.startsWith('description') ? 'description' : field;
  const element = document.querySelector(`[data-error="${key}"]`);
  if (element) element.textContent = message;
  const input = key === 'name' ? $('cardName') : $(key);
  if (input) input.classList.add('is-invalid');
  const effectField = field.match(/^effects\[(\d+)\](?:\.(\w+))?/);
  if (effectField) {
    const row = $('effectRows').children[Number(effectField[1])];
    row?.querySelector(effectField[2] === 'customName' ? '.effect-name' : effectField[2] === 'typeId' ? '.form-select' : '.effect-value')?.classList.add('is-invalid');
  }
}

function markDirty() {
  if (!state.active || state.saving) return;
  state.editingRequest++;
  state.dirty = true;
  $('saveHint').textContent = state.card ? 'Änderungen noch nicht gespeichert' : 'Bereit für dein nächstes Abenteuer.';
}

function context() {
  return { name: $('cardName').value, deckId: state.deckId, sourceId: $('sourceId').value, qrValue: state.qrValue, effects: state.effects };
}

function effectLabel(effect) {
  const type = state.catalog.effectTypes.find(item => item.id === effect.typeId);
  const name = effect.typeId === 'other' ? effect.customName || 'SONSTIGE' : type?.name || effect.typeId;
  return `${name}${effect.value !== null && effect.value !== undefined && effect.value !== '' ? ` ${effect.value}` : ''}`;
}

function updateReferences() {
  const select = $('effectReference');
  select.replaceChildren(new Option('＋ Effektverweis', ''));
  state.effects.forEach(effect => select.add(new Option(effectLabel(effect), effect.id)));
  select.disabled = !state.active || state.effects.length === 0 || state.saving;
  editor?.refreshReferences();
}

function setEntryEnabled(enabled) {
  $('cardFields').disabled = !enabled || state.saving;
  $('descriptionEditor').contentEditable = enabled && !state.saving ? 'true' : 'false';
  $('saveButton').disabled = !enabled || state.saving || Boolean(state.descriptionInvalid);
  $('discardButton').hidden = !enabled;
  $('cameraSelect').disabled = enabled || state.saving;
}

function paintDecks() {
  $('deckButtons').replaceChildren();
  state.catalog.decks.forEach(deck => {
    const choice = button('deck-button', undefined, () => {
      state.deckId = deck.id;
      paintDeckSelection();
      markDirty();
      updateReferences();
      if (state.effects.length === 0) $('effectChoices').querySelector('button')?.focus();
    }, `Deck ${deck.name}`);
    choice.dataset.id = deck.id;
    choice.append(deckIcon(deck), node('span', 'deck-name', deck.name));
    $('deckButtons').append(choice);
    $('deckFilter').add(new Option(deck.name, deck.id));
  });
  paintDeckSelection();
}

function paintDeckSelection() {
  $('deckButtons').querySelectorAll('button').forEach(choice => {
    const selected = choice.dataset.id === state.deckId;
    choice.classList.toggle('selected', selected);
    choice.setAttribute('aria-pressed', String(selected));
  });
}

function buildToolbar() {
  state.catalog.symbols.forEach(symbol => {
    const choice = button('symbol-button', undefined, () => editor.insertSymbol(symbol.id), `${symbol.name} einfügen`);
    choice.append(catalogIcon(symbol));
    choice.title = symbol.name;
    $('symbolButtons').append(choice);
  });
  state.catalog.effectTypes.forEach(type => {
    const choice = button('effect-choice', undefined, () => addEffect(type.id), `${type.name} hinzufügen`);
    choice.append(catalogIcon(type), node('span', '', type.name), node('span', '', '＋'));
    $('effectChoices').append(choice);
  });
}

function addEffect(typeId) {
  if (state.effects.length >= 50) { fieldError('effects', 'Maximal 50 Effekte pro Karte.'); return; }
  const effect = { id: uuid(), typeId, value: typeId === 'other' || !hasEffectValue(typeId) ? null : 0, customName: '' };
  state.effects.push(effect);
  editor.appendEffect(effect.id);
  paintEffects();
  markDirty();
  updateReferences();
  const row = $('effectRows').lastElementChild;
  const target = row.querySelector(typeId === 'other' ? '.effect-name' : hasEffectValue(typeId) ? '.effect-value' : '.form-select');
  target?.focus();
  target?.select?.();
}

function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function paintEffects() {
  $('effectRows').replaceChildren();
  $('effectsEmpty').hidden = state.effects.length > 0;
  state.effects.forEach((effect, index) => {
    const type = state.catalog.effectTypes.find(item => item.id === effect.typeId);
    const row = node('div', 'effect-row');
    row.dataset.id = effect.id;
    row.append(node('span', 'effect-order', String(index + 1).padStart(2, '0')));
    row.append(catalogIcon(type));
    const select = node('select', 'form-select');
    select.setAttribute('aria-label', `Typ von Effekt ${index + 1}`);
    state.catalog.effectTypes.forEach(item => select.add(new Option(item.name, item.id)));
    select.value = effect.typeId;
    select.addEventListener('change', () => {
      effect.typeId = select.value;
      if (effect.typeId !== 'other') effect.customName = '';
      if (!hasEffectValue(effect.typeId)) effect.value = null;
      else if (effect.typeId !== 'other' && effect.value === null) effect.value = 0;
      paintEffects(); markDirty(); updateReferences();
      $('effectRows').querySelector(`[data-id="${effect.id}"] ${effect.typeId === 'other' ? '.effect-name' : hasEffectValue(effect.typeId) ? '.effect-value' : '.form-select'}`)?.focus();
    });
    row.append(select);
    if (effect.typeId === 'other') {
      const name = node('input', 'form-control effect-name');
      name.value = effect.customName || '';
      name.placeholder = 'EFFEKT_NAME';
      name.maxLength = 80;
      name.autocomplete = 'off';
      name.setAttribute('list', 'effectNames');
      name.setAttribute('aria-label', `Name von Effekt ${index + 1}`);
      name.addEventListener('input', () => {
        const caret = name.selectionStart;
        name.value = name.value.toUpperCase().replace(/[\s-]+/g, '_');
        if (caret !== null) name.setSelectionRange(caret, caret);
        effect.customName = name.value;
        markDirty(); updateReferences(); loadEffectNames(name.value);
      });
      name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); row.querySelector('.effect-value')?.focus(); } });
      row.append(name);
    }
    if (hasEffectValue(effect.typeId)) {
      const value = node('input', 'form-control effect-value');
      value.type = 'number'; value.min = '-9999'; value.max = '9999'; value.step = '1';
      value.inputMode = 'numeric'; value.value = effect.value ?? ''; value.placeholder = type?.valueLabel || 'Wert';
      value.setAttribute('aria-label', `${type?.valueLabel || 'Wert'} von Effekt ${index + 1}`);
      value.title = type?.valueLabel || 'Wert';
      value.addEventListener('input', () => {
        effect.value = value.value === '' ? null : Number(value.value);
        markDirty(); updateReferences();
      });
      value.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); editor.focus(); } });
      row.append(value);
    }
    const actions = node('div', 'effect-actions');
    const move = direction => {
      const target = index + direction;
      [state.effects[index], state.effects[target]] = [state.effects[target], state.effects[index]];
      editor.reorderEffectReferences();
      paintEffects(); markDirty(); updateReferences();
      $('effectRows').querySelector(`[data-id="${effect.id}"] .form-select`)?.focus();
    };
    const up = button('icon-button', '↑', () => move(-1), `Effekt ${index + 1} nach oben`);
    up.disabled = index === 0;
    const down = button('icon-button', '↓', () => move(1), `Effekt ${index + 1} nach unten`);
    down.disabled = index === state.effects.length - 1;
    const remove = button('icon-button danger', '×', () => {
      editor.removeEffectReferences(effect.id);
      state.effects.splice(index, 1);
      paintEffects(); markDirty(); updateReferences();
      $('effectChoices').querySelector('button')?.focus();
    }, `Effekt ${index + 1} entfernen`);
    actions.append(up, down, remove); row.append(actions); $('effectRows').append(row);
  });
}

function loadEffectNames(query) {
  clearTimeout(nameTimer);
  const request = ++state.effectNameRequest;
  nameTimer = setTimeout(async () => {
    try {
      const names = await api(`/api/effect-names?q=${encodeURIComponent(query)}`);
      if (request !== state.effectNameRequest) return;
      $('effectNames').replaceChildren(...names.map(name => new Option(name, name)));
    } catch { }
  }, 180);
}

function allowDiscard() {
  return !state.saving && (!state.dirty || confirm('Die ungespeicherten Eingaben verwerfen?'));
}

function resetEntry() {
  state.editingRequest++;
  const rememberDeck = $('rememberDeck').checked;
  const remembered = $('rememberDeck').checked ? state.deckId : '';
  state.active = false; state.card = null; state.effects = []; state.qrValue = ''; state.deckId = remembered; state.dirty = false;
  $('cardForm').reset();
  $('sourceId').value = rememberedSource();
  $('rememberDeck').checked = rememberDeck;
  $('cardName').value = ''; $('nameCounter').textContent = '0 / 50';
  editor?.setSegments([]); clearErrors(); paintDeckSelection(); paintEffects(); updateReferences();
  $('qrValue').textContent = 'Noch keine Karte gescannt'; $('qrCheck').hidden = true;
  $('captureHeading').replaceChildren(document.createTextNode('Karten erfassen'), node('span', 'heading-dot', '.'));
  $('saveButton').replaceChildren(document.createTextNode('Speichern & weiter '), node('span', '', '→'));
  $('saveHint').textContent = 'Scanne eine Karte, um loszulegen.';
  setEntryEnabled(false);
}

function beginEntry(qrValue, card = null) {
  state.editingRequest++;
  scanner.stop();
  state.active = true; state.card = card; state.qrValue = qrValue; state.effects = card ? structuredClone(card.effects) : []; state.dirty = false;
  if (card) state.deckId = card.deckId;
  $('sourceId').value = card ? card.sourceId || 'base-game' : rememberedSource();
  $('cardName').value = card?.name || '';
  $('nameCounter').textContent = `${Array.from($('cardName').value).length} / 50`;
  $('qrValue').textContent = qrValue; $('qrCheck').hidden = false;
  clearErrors(); paintDeckSelection(); paintEffects(); editor.setSegments(card?.description || []); updateReferences();
  state.dirty = false;
  cameraState('stopped');
  $('captureHeading').replaceChildren(document.createTextNode(card ? 'Karte bearbeiten' : 'Karten erfassen'), node('span', 'heading-dot', '.'));
  $('saveButton').replaceChildren(document.createTextNode(card ? 'Änderungen speichern ' : 'Speichern & weiter '), node('span', '', '→'));
  $('saveHint').textContent = card ? 'Gespeicherte Karte bearbeiten' : 'QR erkannt. Jetzt bist du dran.';
  $('cameraButton').textContent = 'Neue Karte scannen';
  $('cameraHint').textContent = 'QR erkannt · Kamera pausiert';
  $('cameraPlaceholder').replaceChildren(node('span', 'camera-symbol', '✓'), node('strong', '', 'QR-Code erfasst'), node('span', '', 'Ergänze die Karte und speichere sie.'));
  setEntryEnabled(true); showCapture();
  $('cardName').focus({ preventScroll: true });
  if (matchMedia('(max-width: 899px)').matches) $('entryHeading').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showCapture() {
  $('captureView').hidden = false; $('libraryView').hidden = true;
  $('captureTab').classList.add('active'); $('captureTab').setAttribute('aria-current', 'page');
  $('libraryTab').classList.remove('active'); $('libraryTab').removeAttribute('aria-current');
}

function cameraState(camera) {
  state.camera = camera;
  const live = camera === 'scanning';
  $('cameraStatus').textContent = live ? '● Live' : camera === 'starting' ? 'Startet …' : state.active ? 'Pausiert' : 'Bereit';
  $('cameraStatus').classList.toggle('live', live);
  $('cameraPlaceholder').hidden = live;
  $('cameraVideo').hidden = !live;
  $('cameraButton').disabled = camera === 'starting' || state.saving;
  $('cameraButton').textContent = live ? 'Kamera pausieren' : state.active ? 'Neue Karte scannen' : 'Kamera starten';
  if (!state.active && !live) $('cameraPlaceholder').replaceChildren(node('span', 'camera-symbol', '▦'), node('strong', '', 'Karte in den Rahmen halten'), node('span', '', 'Kamera starten oder QR-Wert manuell eingeben.'));
  $('cameraHint').textContent = live ? 'Automatische QR-Erkennung' : state.active ? 'QR erkannt · Kamera pausiert' : 'Kamera ist ausgeschaltet';
}

const scanner = new QrScanner({
  video: $('cameraVideo'),
  onScan: value => {
    if (!value.trim() || Array.from(value).length > 2048) { notify('Der QR-Wert ist leer oder länger als 2048 Zeichen. Bitte eine andere Karte scannen.', true); return; }
    beginEntry(value);
  },
  onState: cameraState,
  onDevices: devices => {
    const selected = scanner.stream?.getVideoTracks()[0]?.getSettings()?.deviceId || $('cameraSelect').value;
    $('cameraSelect').replaceChildren(...devices.map((device, index) => new Option(device.label || `Kamera ${index + 1}`, device.deviceId)));
    if (devices.some(device => device.deviceId === selected)) $('cameraSelect').value = selected;
    $('cameraSelect').hidden = devices.length < 2;
  },
  onError: message => { notify(message, true); $('manualDetails').open = true; }
});

function validate() {
  clearErrors();
  let valid = true;
  const fail = (field, message) => { fieldError(field, message); valid = false; };
  if (!$('cardName').value.trim()) fail('name', 'Bitte einen Namen eingeben.');
  if (Array.from($('cardName').value).length > 50) fail('name', 'Der Name darf höchstens 50 Zeichen lang sein.');
  if (!state.deckId) fail('deckId', 'Bitte ein Deck auswählen.');
  if (!$('sourceId').value) fail('sourceId', 'Bitte eine Herkunft auswählen.');
  if (!state.effects.length) fail('effects', 'Bitte mindestens einen Effekt hinzufügen.');
  state.effects.forEach((effect, index) => {
    if (effect.typeId === 'other' && (effect.customName || '').length > 80) fail(`effects[${index}].customName`, `Effekt ${index + 1}: Der Name darf höchstens 80 Zeichen lang sein.`);
    if (effect.typeId === 'other' && !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(effect.customName || '')) fail(`effects[${index}].customName`, `Effekt ${index + 1}: Name als Java-Konstante eingeben, z. B. POISON_EXPLOSION.`);
    if (effect.value === null && effect.typeId !== 'other' && hasEffectValue(effect.typeId)) fail(`effects[${index}].value`, `Effekt ${index + 1}: Bitte einen Wert eingeben.`);
    if (effect.value !== null && !hasEffectValue(effect.typeId)) fail(`effects[${index}].value`, `Effekt ${index + 1}: Dieser Effekt hat keinen Zahlenwert.`);
    if (effect.value !== null && (!Number.isInteger(effect.value) || effect.value < -9999 || effect.value > 9999)) fail(`effects[${index}].value`, `Effekt ${index + 1}: Eine ganze Zahl zwischen −9999 und 9999 eingeben.`);
  });
  if (state.descriptionInvalid) fail('description', state.descriptionInvalid);
  if (!valid) {
    const invalid = document.querySelector('.is-invalid');
    if (invalid?.focus) invalid.focus();
    else document.querySelector('[data-error]:not(:empty)')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return valid;
}

async function saveCard(event) {
  event?.preventDefault();
  if (!state.active || state.saving || !validate()) return;
  const payload = { ...context(), name: $('cardName').value.trim(), description: editor.getSegments(), version: state.card?.version ?? null };
  state.saving = true; setEntryEnabled(true); $('saveButton').textContent = 'Wird gespeichert …';
  $('cameraButton').disabled = true; $('discardButton').disabled = true;
  document.body.classList.add('saving');
  try {
    const editing = Boolean(state.card);
    const saved = await api(editing ? `/api/cards/${state.card.id}` : '/api/cards', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.saving = false; state.dirty = false;
    state.lastSaved = saved;
    if (!editing) state.session++;
    $('sessionCount').textContent = String(state.session);
    $('lastSaved').hidden = false; $('lastSavedName').textContent = saved.name;
    $('lastSavedMeta').textContent = `${state.catalog.decks.find(deck => deck.id === saved.deckId)?.name || saved.deckId} · ${sourceLabel(saved.sourceId)}`;
    resetEntry();
    notify(`${saved.name} wurde gespeichert. Bereit für die nächste Karte.`);
    updateCount();
    if (matchMedia('(max-width: 899px)').matches) $('scannerHeading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    scanner.start($('cameraSelect').value || undefined);
  } catch (error) {
    state.saving = false;
    setEntryEnabled(true);
    $('saveButton').textContent = state.card ? 'Änderungen speichern →' : 'Speichern & weiter →';
    Object.entries(error.fieldErrors || {}).forEach(([field, message]) => fieldError(field, message));
    notify(error.message, true, error.existingCardId ? { text: 'Vorhandene Karte öffnen', run: () => editCard(error.existingCardId) } : undefined);
  } finally {
    state.saving = false; $('cameraButton').disabled = state.camera === 'starting'; $('discardButton').disabled = false; document.body.classList.remove('saving');
  }
}

async function updateCount() {
  try { const result = await api('/api/cards?size=1'); $('cardCount').textContent = String(result.totalElements); } catch { }
}

async function showLibrary() {
  if (state.saving) return;
  scanner.stop();
  $('captureView').hidden = true; $('libraryView').hidden = false;
  $('captureTab').classList.remove('active'); $('captureTab').removeAttribute('aria-current');
  $('libraryTab').classList.add('active'); $('libraryTab').setAttribute('aria-current', 'page');
  await loadCards();
}

async function loadCards() {
  const request = ++state.listRequest;
  $('cardList').replaceChildren(node('div', 'list-loading', 'Karten werden geladen …'));
  $('previousPage').disabled = true; $('nextPage').disabled = true;
  const params = new URLSearchParams({ q: $('cardSearch').value, deckId: $('deckFilter').value, page: state.page, size: 20 });
  try {
    const result = await api(`/api/cards?${params}`);
    if (request !== state.listRequest) return;
    state.totalPages = result.totalPages;
    $('cardList').replaceChildren();
    if (!result.content.length) {
      const empty = node('div', 'empty-library');
      empty.append(node('span', '', '▤'), node('strong', '', result.totalElements ? 'Keine Karten auf dieser Seite' : 'Hier ist Platz für deine Karten'), node('p', '', $('cardSearch').value || $('deckFilter').value ? 'Versuche einen anderen Suchbegriff oder ein anderes Deck.' : 'Scanne deine erste Karte. Sie erscheint anschließend hier.'));
      $('cardList').append(empty);
    }
    result.content.forEach(card => {
      const row = node('article', 'card-list-row');
      const title = node('div', 'card-title');
      const labels = node('div'); labels.append(node('strong', '', card.name), node('small', '', card.qrValue));
      title.append(labels);
      const tags = node('div', 'card-tags');
      const deck = state.catalog.decks.find(item => item.id === card.deckId);
      const deckTag = node('span', 'card-tag');
      deckTag.append(deckIcon(deck), document.createTextNode(` ${deck?.name || card.deckId}`));
      tags.append(deckTag);
      tags.append(node('span', 'card-tag', sourceLabel(card.sourceId)));
      card.effects.forEach(effect => {
        const type = state.catalog.effectTypes.find(item => item.id === effect.typeId);
        const tag = node('span', 'card-tag');
        tag.append(catalogIcon(type), document.createTextNode(` ${effectLabel(effect)}`));
        tags.append(tag);
      });
      row.append(title, tags, button('text-button edit-card', 'Bearbeiten ↗', () => editCard(card.id), `${card.name} bearbeiten`));
      $('cardList').append(row);
    });
    $('listSummary').textContent = `${result.totalElements} ${result.totalElements === 1 ? 'Karte' : 'Karten'}`;
    $('pageLabel').textContent = `${state.page + 1} / ${Math.max(1, result.totalPages)}`;
    $('previousPage').disabled = state.page === 0;
    $('nextPage').disabled = state.page + 1 >= result.totalPages;
  } catch (error) {
    if (request !== state.listRequest) return;
    $('cardList').replaceChildren(node('div', 'empty-library', error.message), button('btn btn-outline-dark m-3', 'Erneut laden', loadCards));
  }
}

async function editCard(id) {
  if (!allowDiscard()) return;
  scanner.stop();
  const request = ++state.editingRequest;
  try {
    const card = await api(`/api/cards/${id}`);
    if (request !== state.editingRequest) return;
    beginEntry(card.qrValue, card);
  } catch (error) { notify(error.message, true); }
}

$('cardForm').addEventListener('submit', saveCard);
$('sourceId').addEventListener('change', () => {
  preferredSource = $('sourceId').value;
  try { localStorage.setItem('bossqr.sourceId', preferredSource); } catch { }
  markDirty();
});
$('cameraButton').addEventListener('click', async () => {
  if (state.camera === 'scanning') { scanner.stop(); return; }
  if (!allowDiscard()) return;
  resetEntry(); await scanner.start($('cameraSelect').value || undefined);
});
$('cameraSelect').addEventListener('change', () => { if (!state.active && state.camera === 'scanning') scanner.start($('cameraSelect').value); });
$('manualButton').addEventListener('click', () => {
  if (!state.catalog || !allowDiscard()) return;
  const qr = $('manualQr').value.trim();
  if (!qr) { $('manualQr').focus(); notify('Bitte zuerst einen QR-Wert eingeben.', true); return; }
  beginEntry(qr); $('manualQr').value = ''; $('manualDetails').open = false;
});
$('discardButton').addEventListener('click', async () => { if (allowDiscard()) { resetEntry(); await scanner.start($('cameraSelect').value || undefined); } });
$('captureTab').addEventListener('click', async () => { const wasHidden = $('captureView').hidden; showCapture(); if (wasHidden && !state.active && !state.saving) await scanner.start($('cameraSelect').value || undefined); });
$('libraryTab').addEventListener('click', showLibrary);
$('newCardButton').addEventListener('click', async () => { if (allowDiscard()) { resetEntry(); showCapture(); await scanner.start($('cameraSelect').value || undefined); } });
$('lastSavedEdit').addEventListener('click', () => { if (state.lastSaved) editCard(state.lastSaved.id); });
$('cardName').addEventListener('input', () => {
  const characters = Array.from($('cardName').value);
  if (characters.length > 50) $('cardName').value = characters.slice(0, 50).join('');
  $('nameCounter').textContent = `${Math.min(characters.length, 50)} / 50`;
  markDirty(); updateReferences();
});
$('cardName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); ($('deckButtons').querySelector('.selected') || $('deckButtons').querySelector('button'))?.focus(); } });
$('effectReference').addEventListener('change', event => { if (event.target.value) editor.insertEffect(event.target.value); event.target.value = ''; });
$('variableReference').addEventListener('change', event => { if (event.target.value) editor.insertVariable(event.target.value); event.target.value = ''; });
$('cardSearch').addEventListener('input', () => { clearTimeout(searchTimer); state.page = 0; state.listRequest++; searchTimer = setTimeout(loadCards, 220); });
$('deckFilter').addEventListener('change', () => { state.page = 0; loadCards(); });
$('previousPage').addEventListener('click', () => { if (state.page > 0) { state.page--; loadCards(); } });
$('nextPage').addEventListener('click', () => { if (state.page + 1 < state.totalPages) { state.page++; loadCards(); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('captureView').hidden) { event.preventDefault(); saveCard(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) scanner.stop(); });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => scanner.stop());

async function initialize() {
  try {
    state.catalog = await api('/api/catalog');
    editor = new DescriptionEditor({ element: $('descriptionEditor'), counter: $('descriptionCounter'), catalog: state.catalog, getContext: context, onChange: markDirty, onInvalid: message => {
      state.descriptionInvalid = message;
      fieldError('description', message || '');
      if (state.active) $('saveButton').disabled = state.saving || Boolean(message);
    } });
    paintDecks(); buildToolbar(); resetEntry(); updateCount(); loadEffectNames('');
    await scanner.start();
  } catch (error) {
    notify(`Die Anwendung konnte nicht geladen werden: ${error.message}`, true, { text: 'Erneut versuchen', run: () => location.reload() });
    $('cameraButton').disabled = true; $('manualButton').disabled = true;
  }
}

initialize();
