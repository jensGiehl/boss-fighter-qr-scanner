const VARIABLE_LABELS = {
    name: "Name",
    deckName: "Deckname",
    qrValue: "QR-Wert"
};

const BLOCK_ELEMENTS = new Set(["DIV", "P", "LI", "UL", "OL", "PRE", "BLOCKQUOTE"]);

export class DescriptionEditor {
    constructor({element, counter, onChange, onInvalid, catalog, getContext}) {
        this.element = element;
        this.counter = counter;
        this.onChange = onChange ?? (() => {});
        this.onInvalid = onInvalid ?? (() => {});
        this.catalog = catalog ?? {};
        this.getContext = getContext ?? (() => ({}));
        this.segments = [];
        this.savedSelection = {start: 0, end: 0, backward: false};
        this.beforeInputSelection = this.savedSelection;
        this.composing = false;
        this.destroyed = false;
        this.referenceLabels = new Map();
        this.history = [];
        this.historyIndex = -1;
        this.limitTimeout = null;
        this.element.contentEditable = "true";
        this.element.setAttribute("role", "textbox");
        this.element.setAttribute("aria-multiline", "true");
        this.element.style.whiteSpace = "pre-wrap";
        this.element.spellcheck = true;
        this.handleSelectionChange = () => {
            const selection = this.captureSelection();
            if (selection) this.savedSelection = selection;
        };
        this.handleBeforeInput = event => this.beforeInput(event);
        this.handleInput = () => {
            if (!this.composing) this.acceptDomInput();
        };
        this.handlePaste = event => {
            event.preventDefault();
            this.insertSegments([{kind: "text", text: this.normalizeText(event.clipboardData?.getData("text/plain") ?? "")}]);
        };
        this.handleDrop = event => {
            event.preventDefault();
            this.insertSegments([{kind: "text", text: this.normalizeText(event.dataTransfer?.getData("text/plain") ?? "")}]);
        };
        this.handleCompositionStart = () => {
            this.beforeInputSelection = this.captureSelection() ?? this.savedSelection;
            this.composing = true;
        };
        this.handleCompositionEnd = () => {
            this.composing = false;
            this.acceptDomInput();
        };
        this.handleKeyDown = event => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key === "z" || key === "y") {
                event.preventDefault();
                this.restoreHistory(key === "y" || event.shiftKey ? 1 : -1);
            }
        };
        this.element.addEventListener("beforeinput", this.handleBeforeInput);
        this.element.addEventListener("input", this.handleInput);
        this.element.addEventListener("paste", this.handlePaste);
        this.element.addEventListener("drop", this.handleDrop);
        this.element.addEventListener("compositionstart", this.handleCompositionStart);
        this.element.addEventListener("compositionend", this.handleCompositionEnd);
        this.element.addEventListener("keydown", this.handleKeyDown);
        document.addEventListener("selectionchange", this.handleSelectionChange);
        this.setSegments(this.parseDom(this.element));
    }

    setSegments(segments) {
        this.segments = this.normalizeSegments(segments);
        const end = this.logicalLength(this.segments);
        this.savedSelection = {start: end, end, backward: false};
        this.render(this.savedSelection);
        this.history = [{segments: this.getSegments(), selection: {...this.savedSelection}}];
        this.historyIndex = 0;
        this.notify(true);
    }

    getSegments() {
        return this.segments.map(segment => ({...segment}));
    }

    insertSymbol(symbolId) {
        return this.insertSegments([{kind: "symbol", symbolId: String(symbolId)}]);
    }

    insertEffect(effectId) {
        return this.insertSegments([{kind: "effect", effectId: String(effectId)}]);
    }

    insertVariable(variable) {
        if (!Object.hasOwn(VARIABLE_LABELS, variable)) return false;
        return this.insertSegments([{kind: "variable", variable}]);
    }

    removeEffectReferences(effectId) {
        const text = this.effectText(String(effectId));
        const next = this.segments.map(segment => segment.kind === "effect" && segment.effectId === String(effectId)
            ? {kind: "text", text}
            : segment);
        const selection = this.captureSelection() ?? this.savedSelection;
        const replacements = this.segments.filter(segment => segment.kind === "effect" && segment.effectId === String(effectId));
        if (!replacements.length) return;
        const start = this.convertedOffset(selection.start, String(effectId), text.length);
        const end = this.convertedOffset(selection.end, String(effectId), text.length);
        this.commit(next, {start, end, backward: selection.backward}, false);
    }

    convertedOffset(offset, effectId, textLength) {
        let position = 0;
        let converted = offset;
        for (const segment of this.segments) {
            const length = segment.kind === "text" ? segment.text.length : 1;
            if (segment.kind === "effect" && segment.effectId === effectId && position < offset) {
                converted += textLength - 1;
            }
            position += length;
        }
        return Math.max(0, converted);
    }

    refreshReferences() {
        if (this.destroyed) return;
        const selection = this.captureSelection() ?? this.savedSelection;
        this.render(selection);
        this.notify(false);
    }

    focus() {
        this.element.focus({preventScroll: true});
        this.restoreSelection(this.savedSelection);
    }

    getText() {
        return this.expandedText(this.segments);
    }

    beforeInput(event) {
        if (!this.composing) this.beforeInputSelection = this.captureSelection() ?? this.savedSelection;
        if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
            event.preventDefault();
            this.insertSegments([{kind: "text", text: "\n"}]);
        } else if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
            event.preventDefault();
            this.restoreHistory(event.inputType === "historyUndo" ? -1 : 1);
        } else if (event.inputType?.startsWith("format") || event.inputType === "insertHTML") {
            event.preventDefault();
        }
    }

    acceptDomInput() {
        const next = this.parseDom(this.element);
        const selection = this.captureSelection() ?? this.savedSelection;
        if (!this.commit(next, selection)) {
            this.render(this.beforeInputSelection);
        }
    }

    insertSegments(segments) {
        if (this.destroyed) return false;
        const incoming = this.normalizeSegments(segments);
        if (!incoming.length) return false;
        const selection = this.captureSelection() ?? this.savedSelection;
        const next = this.normalizeSegments([
            ...this.sliceSegments(this.segments, 0, selection.start),
            ...incoming,
            ...this.sliceSegments(this.segments, selection.end, this.logicalLength(this.segments))
        ]);
        const offset = selection.start + this.logicalLength(incoming);
        this.beforeInputSelection = selection;
        const accepted = this.commit(next, {start: offset, end: offset, backward: false});
        this.focus();
        return accepted;
    }

    commit(segments, selection, enforceLimit = true) {
        const next = this.normalizeSegments(segments);
        const length = Array.from(this.expandedText(next)).length;
        const previousLength = Array.from(this.getText()).length;
        if (enforceLimit && length > 400 && length >= previousLength) {
            this.showLimit();
            this.notify(false);
            return false;
        }
        if (this.historyIndex >= 0) {
            this.history[this.historyIndex].selection = {...this.beforeInputSelection};
        }
        const changed = JSON.stringify(this.segments) !== JSON.stringify(next);
        this.segments = next;
        this.savedSelection = {...selection};
        this.render(selection);
        if (changed) {
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push({segments: this.getSegments(), selection: {...selection}});
            if (this.history.length > 100) this.history.shift();
            this.historyIndex = this.history.length - 1;
        }
        this.notify(changed);
        return true;
    }

    restoreHistory(direction) {
        const nextIndex = this.historyIndex + direction;
        if (nextIndex < 0 || nextIndex >= this.history.length) return;
        this.historyIndex = nextIndex;
        const entry = this.history[nextIndex];
        this.segments = this.normalizeSegments(entry.segments);
        this.savedSelection = {...entry.selection};
        this.render(this.savedSelection, true);
        this.notify(true);
    }

    normalizeText(text) {
        return String(text).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/\u0000/g, "");
    }

    normalizeSegments(segments) {
        const normalized = [];
        for (const segment of Array.isArray(segments) ? segments : []) {
            let next;
            if (segment?.kind === "text") {
                const text = this.normalizeText(segment.text ?? "");
                if (!text) continue;
                const last = normalized.at(-1);
                if (last?.kind === "text") {
                    last.text += text;
                    continue;
                }
                next = {kind: "text", text};
            } else if (segment?.kind === "symbol" && segment.symbolId != null) {
                next = {kind: "symbol", symbolId: String(segment.symbolId)};
            } else if (segment?.kind === "effect" && segment.effectId != null) {
                next = {kind: "effect", effectId: String(segment.effectId)};
            } else if (segment?.kind === "variable" && Object.hasOwn(VARIABLE_LABELS, segment.variable)) {
                next = {kind: "variable", variable: segment.variable};
            }
            if (next) normalized.push(next);
        }
        return normalized;
    }

    parseDom(container) {
        const segments = [];
        const appendText = text => {
            if (text) segments.push({kind: "text", text});
        };
        const ensureNewline = () => {
            const last = segments.at(-1);
            if (last && !(last.kind === "text" && last.text.endsWith("\n"))) appendText("\n");
        };
        const visit = node => {
            if (node.nodeType === Node.TEXT_NODE) {
                appendText(node.textContent ?? "");
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
            if (node.dataset?.editorSentinel === "true") return;
            const token = this.segmentFromNode(node);
            if (token) {
                segments.push(token);
                return;
            }
            if (node.nodeName === "BR") {
                appendText("\n");
                return;
            }
            for (const child of node.childNodes) {
                const block = BLOCK_ELEMENTS.has(child.nodeName);
                if (block) ensureNewline();
                visit(child);
                if (block && child.nextSibling) ensureNewline();
            }
        };
        if (container.childNodes.length === 1 && container.firstChild.nodeName === "BR") return [];
        visit(container);
        return this.normalizeSegments(segments);
    }

    segmentFromNode(node) {
        const data = node.dataset;
        if (!data) return null;
        if (data.kind === "symbol" && data.symbolId !== undefined) return {kind: "symbol", symbolId: data.symbolId};
        if (data.kind === "effect" && data.effectId !== undefined) return {kind: "effect", effectId: data.effectId};
        if (data.kind === "variable" && Object.hasOwn(VARIABLE_LABELS, data.variable)) return {kind: "variable", variable: data.variable};
        return null;
    }

    sliceSegments(segments, start, end) {
        let position = 0;
        const result = [];
        for (const segment of segments) {
            const length = segment.kind === "text" ? segment.text.length : 1;
            if (position < end && position + length > start) {
                if (segment.kind === "text") {
                    result.push({kind: "text", text: segment.text.slice(Math.max(0, start - position), Math.min(length, end - position))});
                } else {
                    result.push({...segment});
                }
            }
            position += length;
        }
        return result;
    }

    logicalLength(segments) {
        return segments.reduce((length, segment) => length + (segment.kind === "text" ? segment.text.length : 1), 0);
    }

    captureSelection() {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (!this.element.contains(range.startContainer) || !this.element.contains(range.endContainer)) return null;
        const offset = (node, position) => {
            const prefix = document.createRange();
            prefix.selectNodeContents(this.element);
            prefix.setEnd(node, position);
            return this.logicalLength(this.parseDom(prefix.cloneContents()));
        };
        return {
            start: offset(range.startContainer, range.startOffset),
            end: offset(range.endContainer, range.endOffset),
            backward: !range.collapsed && selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset
        };
    }

    pointAt(offset) {
        let remaining = Math.max(0, offset);
        for (let index = 0; index < this.element.childNodes.length; index++) {
            const node = this.element.childNodes[index];
            if (node.nodeType === Node.TEXT_NODE) {
                if (remaining <= node.textContent.length) return {node, offset: remaining};
                remaining -= node.textContent.length;
            } else {
                if (remaining === 0) return {node: this.element, offset: index};
                remaining--;
                if (remaining === 0) return {node: this.element, offset: index + 1};
            }
        }
        return {node: this.element, offset: this.element.childNodes.length};
    }

    restoreSelection(snapshot) {
        if (this.destroyed) return;
        const length = this.logicalLength(this.segments);
        const start = this.pointAt(Math.min(snapshot.start, length));
        const end = this.pointAt(Math.min(snapshot.end, length));
        const selection = window.getSelection();
        if (!selection) return;
        if (typeof selection.setBaseAndExtent === "function") {
            const anchor = snapshot.backward ? end : start;
            const focus = snapshot.backward ? start : end;
            selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        } else {
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        this.savedSelection = {...snapshot, start: Math.min(snapshot.start, length), end: Math.min(snapshot.end, length)};
    }

    render(selection, focus = false) {
        const focused = this.element === document.activeElement || this.element.contains(document.activeElement);
        const fragment = document.createDocumentFragment();
        for (const segment of this.segments) {
            if (segment.kind === "text") {
                fragment.append(document.createTextNode(segment.text));
            } else {
                const token = document.createElement("span");
                token.className = `description-token token-${segment.kind}`;
                token.contentEditable = "false";
                token.dataset.kind = segment.kind;
                if (segment.kind === "symbol") {
                    token.dataset.symbolId = segment.symbolId;
                    const symbol = this.catalog.symbols?.find(item => item.id === segment.symbolId);
                    const icon = document.createElement("span");
                    icon.className = "catalog-icon";
                    icon.textContent = symbol?.icon ?? "�";
                    if (symbol?.id === "poison" && symbol.icon === "💧") icon.classList.add("poison-icon");
                    token.append(icon);
                    token.title = symbol?.name ?? "Unbekanntes Symbol";
                } else if (segment.kind === "effect") {
                    token.dataset.effectId = segment.effectId;
                    token.textContent = this.effectText(segment.effectId);
                    token.title = "Effekt-Verweis: Ändert sich zusammen mit dem Effekt";
                } else {
                    token.dataset.variable = segment.variable;
                    token.textContent = this.variableText(segment.variable) || VARIABLE_LABELS[segment.variable];
                    token.title = `Variable: ${VARIABLE_LABELS[segment.variable]}`;
                }
                token.setAttribute("aria-label", token.title);
                fragment.append(token);
            }
        }
        if (!fragment.lastChild || fragment.lastChild.nodeType !== Node.TEXT_NODE) {
            fragment.append(document.createTextNode(""));
        } else if (fragment.lastChild.textContent.endsWith("\n")) {
            const sentinel = document.createElement("br");
            sentinel.dataset.editorSentinel = "true";
            sentinel.setAttribute("aria-hidden", "true");
            fragment.append(sentinel);
        }
        this.element.replaceChildren(fragment);
        this.savedSelection = {...selection};
        if (focused || focus) {
            if (focus) this.element.focus({preventScroll: true});
            this.restoreSelection(selection);
        }
    }

    effectText(effectId) {
        const effect = this.getContext().effects?.find(item => String(item.id) === effectId);
        if (!effect) return this.referenceLabels.get(effectId) ?? "Entfernter Effekt";
        const type = this.catalog.effectTypes?.find(item => item.id === effect.typeId);
        const name = effect.typeId === "other"
            ? effect.customName || type?.name || "Sonstige"
            : type?.name || effect.typeId || "Effekt";
        const value = effect.value === undefined || effect.value === null || String(effect.value).trim() === "" ? "" : ` ${effect.value}`;
        const text = `${name}${value}`;
        this.referenceLabels.set(effectId, text);
        return text;
    }

    variableText(variable) {
        const context = this.getContext();
        if (variable === "deckName") {
            return this.catalog.decks?.find(deck => deck.id === context.deckId)?.name ?? "";
        }
        return String(context[variable] ?? "");
    }

    expandedText(segments) {
        return segments.map(segment => {
            if (segment.kind === "text") return segment.text;
            if (segment.kind === "effect") return this.effectText(segment.effectId);
            if (segment.kind === "variable") return this.variableText(segment.variable);
            return this.catalog.symbols?.find(symbol => symbol.id === segment.symbolId)?.icon ?? "�";
        }).join("");
    }

    notify(changed) {
        const text = this.getText();
        const length = Array.from(text).length;
        const context = this.getContext();
        const unavailable = this.segments.some(segment =>
            segment.kind === "effect" && !context.effects?.some(effect => String(effect.id) === segment.effectId)
            || segment.kind === "symbol" && !this.catalog.symbols?.some(symbol => symbol.id === segment.symbolId));
        const message = length > 400
            ? `Die Beschreibung hat ${length} Zeichen. Erlaubt sind höchstens 400. Kürze den Text oder einen verwendeten Wert.`
            : unavailable ? "Ein Verweis in der Beschreibung ist nicht mehr verfügbar." : null;
        if (this.counter) {
            this.counter.textContent = `${length}/400`;
            this.counter.classList.toggle("is-invalid", Boolean(message));
        }
        this.element.setAttribute("aria-invalid", String(Boolean(message)));
        this.onInvalid(message);
        if (changed) this.onChange(this.getSegments(), text);
    }

    showLimit() {
        this.element.classList.add("description-limit-reached");
        if (this.counter) this.counter.title = "Die Beschreibung darf höchstens 400 Zeichen enthalten.";
        clearTimeout(this.limitTimeout);
        this.limitTimeout = setTimeout(() => {
            this.element.classList.remove("description-limit-reached");
            if (this.counter) this.counter.removeAttribute("title");
        }, 900);
    }

    destroy() {
        this.destroyed = true;
        clearTimeout(this.limitTimeout);
        document.removeEventListener("selectionchange", this.handleSelectionChange);
        this.element.removeEventListener("beforeinput", this.handleBeforeInput);
        this.element.removeEventListener("input", this.handleInput);
        this.element.removeEventListener("paste", this.handlePaste);
        this.element.removeEventListener("drop", this.handleDrop);
        this.element.removeEventListener("compositionstart", this.handleCompositionStart);
        this.element.removeEventListener("compositionend", this.handleCompositionEnd);
        this.element.removeEventListener("keydown", this.handleKeyDown);
    }
}
