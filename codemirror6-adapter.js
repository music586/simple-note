const {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField
} = require('@codemirror/state');
const {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  keymap,
  lineNumbers
} = require('@codemirror/view');
const {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
  redo,
  selectAll,
  undo
} = require('@codemirror/commands');
const { markdown } = require('@codemirror/lang-markdown');
const { HighlightStyle, syntaxHighlighting } = require('@codemirror/language');
const { tags } = require('@lezer/highlight');

const addDecorationEffect = StateEffect.define();
const clearDecorationEffect = StateEffect.define();
const clearAllDecorationsEffect = StateEffect.define();
let nextDecorationId = 1;

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading,
    color: 'var(--md-heading)',
    fontWeight: '700',
    textDecoration: 'none'
  },
  { tag: tags.strong, color: 'var(--md-heading)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--md-accent)', textDecoration: 'none' },
  {
    tag: tags.monospace,
    color: 'var(--md-accent)',
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
  },
  { tag: [tags.quote, tags.meta], color: 'var(--md-muted)' }
]);

class DomWidget extends WidgetType {
  constructor(dom, block = false) {
    super();
    this.dom = dom;
    this.block = block;
  }

  eq(other) {
    return this.dom === other.dom;
  }

  toDOM() {
    return this.dom;
  }

  ignoreEvent() {
    return true;
  }
}

const decorationField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(clearAllDecorationsEffect)) {
        decorations = Decoration.none;
      } else if (effect.is(clearDecorationEffect)) {
        decorations = decorations.update({
          filter: (from, to, value) => value.spec.simpleNoteId !== effect.value
        });
      } else if (effect.is(addDecorationEffect)) {
        decorations = decorations.update({ add: [effect.value], sort: true });
      }
    }
    return decorations;
  },
  provide: field => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of(view => {
      const builder = new RangeSetBuilder();
      view.state.field(field).between(0, view.state.doc.length, (from, to, value) => {
        if (value.spec.simpleNoteAtomic) builder.add(from, to, value);
      });
      return builder.finish();
    })
  ]
});

function clampPosition(state, position) {
  return Math.max(0, Math.min(Number(position) || 0, state.doc.length));
}

function normalizeLineCh(state, position) {
  if (typeof position === 'number') return clampPosition(state, position);
  const lineNumber = Math.max(1, Math.min((position?.line || 0) + 1, state.doc.lines));
  const line = state.doc.line(lineNumber);
  return Math.min(line.to, line.from + Math.max(0, position?.ch || 0));
}

function toLineCh(state, position) {
  const line = state.doc.lineAt(clampPosition(state, position));
  return { line: line.number - 1, ch: position - line.from };
}

function lineChToTextOffset(text, position) {
  if (typeof position === 'number') return Math.max(0, Math.min(position, text.length));
  const lines = text.split('\n');
  const lineNumber = Math.max(0, Math.min(position?.line || 0, lines.length - 1));
  let offset = 0;
  for (let line = 0; line < lineNumber; line += 1) offset += lines[line].length + 1;
  return offset + Math.min(Math.max(0, position?.ch || 0), lines[lineNumber].length);
}

function classAttributes(className) {
  return className ? { class: className } : undefined;
}

class CodeMirror6Adapter {
  constructor(textarea, options = {}) {
    this.handlers = new Map();
    this.textarea = textarea;
    this.suppressChange = false;
    this.lastViewport = null;
    this.lineNumbersCompartment = new Compartment();
    this.lineNumbersVisible = Boolean(options.lineNumbers);

    const customKeys = Object.entries(options.extraKeys || {}).map(([key, handler]) => ({
      key: key.replace('Cmd-', 'Meta-').replace(/-([A-Z])$/, (_, letter) => `-${letter.toLowerCase()}`),
      run: () => handler(this) !== Pass
    }));
    const extensions = [
      history(),
      markdown(),
      syntaxHighlighting(markdownHighlightStyle),
      EditorView.lineWrapping,
      this.lineNumbersCompartment.of(this.lineNumbersVisible ? lineNumbers() : []),
      drawSelection(),
      decorationField,
      keymap.of([
        ...customKeys,
        { key: 'Meta-a', run: selectAll },
        { key: 'Ctrl-a', run: selectAll },
        { key: 'Meta-z', run: undo },
        { key: 'Shift-Meta-z', run: redo },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      EditorState.tabSize.of(options.tabSize || 6),
      EditorView.updateListener.of(update => this.handleUpdate(update)),
      EditorView.domEventHandlers({
        focus: () => this.emit('focus'),
        blur: () => this.emit('blur'),
        scroll: () => {
          this.emit('scroll');
          this.emitViewport();
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' }
      })
    ];

    const parent = textarea.parentElement;
    textarea.hidden = true;
    this.view = new EditorView({
      state: EditorState.create({ doc: textarea.value || '', extensions }),
      parent
    });
    this.view.dom.simpleNoteEditor = this;
    this.lastViewport = this.getViewport();
  }

  handleUpdate(update) {
    if (update.docChanged) {
      this.textarea.value = update.state.doc.toString();
      this.emit('change');
      this.emit('inputRead');
    }
    if (update.selectionSet) this.emit('cursorActivity');
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.emitViewport();
    }
  }

  emitViewport() {
    const viewport = this.getViewport();
    if (
      this.lastViewport
      && viewport.from === this.lastViewport.from
      && viewport.to === this.lastViewport.to
    ) return;
    const previous = this.lastViewport || viewport;
    this.lastViewport = viewport;
    this.emit('viewportChange', previous.from, previous.to);
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }

  emit(type, ...args) {
    for (const handler of this.handlers.get(type) || []) handler(this, ...args);
  }

  operation(callback) {
    return callback();
  }

  getValue() {
    return this.view.state.doc.toString();
  }

  setValue(value) {
    const text = String(value || '');
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.cursor(0)
    });
  }

  lineCount() {
    return this.view.state.doc.lines;
  }

  getLine(lineNumber) {
    const number = Number(lineNumber) + 1;
    if (number < 1 || number > this.view.state.doc.lines) return undefined;
    return this.view.state.doc.line(number).text;
  }

  eachLine(from, to, callback) {
    for (let line = from; line < Math.min(to, this.lineCount()); line += 1) {
      callback({ line, text: this.getLine(line) });
    }
  }

  getLineNumber(lineHandle) {
    return typeof lineHandle === 'number' ? lineHandle : lineHandle?.line;
  }

  posFromIndex(index) {
    return toLineCh(this.view.state, index);
  }

  indexFromPos(position) {
    return normalizeLineCh(this.view.state, position);
  }

  getCursor(which) {
    const selection = this.view.state.selection.main;
    const position = which === 'from'
      ? selection.from
      : which === 'to'
        ? selection.to
        : selection.head;
    return toLineCh(this.view.state, position);
  }

  setCursor(position) {
    const anchor = normalizeLineCh(this.view.state, position);
    this.view.dispatch({ selection: EditorSelection.cursor(anchor) });
  }

  setSelection(anchor, head = anchor) {
    this.view.dispatch({
      selection: EditorSelection.single(
        normalizeLineCh(this.view.state, anchor),
        normalizeLineCh(this.view.state, head)
      )
    });
  }

  somethingSelected() {
    return this.view.state.selection.ranges.some(range => !range.empty);
  }

  getRange(from, to) {
    return this.view.state.sliceDoc(
      normalizeLineCh(this.view.state, from),
      normalizeLineCh(this.view.state, to)
    );
  }

  replaceRange(text, from, to = from) {
    const start = normalizeLineCh(this.view.state, from);
    const end = normalizeLineCh(this.view.state, to);
    this.view.dispatch({ changes: { from: start, to: end, insert: String(text) } });
  }

  applyEdit(edit) {
    if (!edit) return false;
    const from = normalizeLineCh(this.view.state, edit.from);
    const to = normalizeLineCh(this.view.state, edit.to);
    const text = String(edit.text);
    const currentDocument = this.view.state.doc.toString();
    const nextDocument = currentDocument.slice(0, from) + text + currentDocument.slice(to);
    const cursor = lineChToTextOffset(nextDocument, edit.cursor);
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(cursor)
    });
    return true;
  }

  execCommand(command) {
    if (command === 'newlineAndIndent') return insertNewlineAndIndent(this.view);
    if (command === 'selectAll') return selectAll(this.view);
    if (command === 'undo') return undo(this.view);
    if (command === 'redo') return redo(this.view);
    return false;
  }

  createDecoration(from, to, decoration) {
    const id = nextDecorationId++;
    const range = decoration.range(from, to);
    range.value.spec.simpleNoteId = id;
    this.view.dispatch({ effects: addDecorationEffect.of(range) });
    let cleared = false;
    return {
      clear: () => {
        if (cleared) return;
        cleared = true;
        this.view.dispatch({ effects: clearDecorationEffect.of(id) });
      },
      changed: () => this.view.requestMeasure(),
      find: () => {
        if (cleared) return undefined;
        let found;
        this.view.state.field(decorationField).between(0, this.view.state.doc.length, (
          rangeFrom,
          rangeTo,
          value
        ) => {
          if (value.spec.simpleNoteId === id) found = { from: rangeFrom, to: rangeTo };
        });
        return found && {
          from: toLineCh(this.view.state, found.from),
          to: toLineCh(this.view.state, found.to)
        };
      }
    };
  }

  addMarkDecoration(from, to, options = {}) {
    const start = normalizeLineCh(this.view.state, from);
    const end = normalizeLineCh(this.view.state, to);
    if (start === end && !options.replacedWith) {
      let cleared = false;
      return {
        clear() {
          cleared = true;
        },
        changed: () => {
          if (!cleared) this.view.requestMeasure();
        },
        find: () => cleared ? undefined : {
          from: toLineCh(this.view.state, start),
          to: toLineCh(this.view.state, end)
        }
      };
    }
    const spec = { simpleNoteId: 0, simpleNoteAtomic: Boolean(options.atomic) };
    let decoration;
    if (start === end && options.replacedWith) {
      decoration = Decoration.widget({
        ...spec,
        widget: new DomWidget(options.replacedWith)
      });
    } else if (options.collapsed || options.replacedWith) {
      if (options.replacedWith) spec.widget = new DomWidget(options.replacedWith);
      if (options.className) spec.attributes = classAttributes(options.className);
      decoration = Decoration.replace(spec);
    } else {
      decoration = Decoration.mark({
        ...spec,
        attributes: classAttributes(options.className)
      });
    }
    return this.createDecoration(start, end, decoration);
  }

  addWidgetDecoration(position, options = {}) {
    const offset = normalizeLineCh(this.view.state, position);
    return this.createDecoration(offset, offset, Decoration.widget({
      simpleNoteId: 0,
      widget: new DomWidget(options.widget),
      side: options.insertLeft ? -1 : 1
    }));
  }

  addLineDecoration(lineNumber, where, className) {
    const line = this.view.state.doc.line(Math.min(lineNumber + 1, this.lineCount()));
    const handle = this.createDecoration(line.from, line.from, Decoration.line({
      simpleNoteId: 0,
      attributes: classAttributes(className)
    }));
    return { line: lineNumber, className, handle };
  }

  removeLineDecoration(lineHandle, where, className) {
    if (lineHandle?.handle) lineHandle.handle.clear();
  }

  addBlockWidget(lineNumber, dom) {
    const line = this.view.state.doc.line(Math.min(lineNumber + 1, this.lineCount()));
    return this.createDecoration(line.to, line.to, Decoration.widget({
      simpleNoteId: 0,
      block: true,
      side: 1,
      widget: new DomWidget(dom, true)
    }));
  }

  getViewport() {
    if (!this.view.visibleRanges.length) return { from: 0, to: this.lineCount() };
    const from = this.view.state.doc.lineAt(this.view.visibleRanges[0].from).number - 1;
    const last = this.view.visibleRanges[this.view.visibleRanges.length - 1];
    const to = this.view.state.doc.lineAt(last.to).number;
    return { from, to };
  }

  getScrollInfo() {
    return {
      left: this.view.scrollDOM.scrollLeft,
      top: this.view.scrollDOM.scrollTop,
      height: this.view.scrollDOM.scrollHeight,
      width: this.view.scrollDOM.scrollWidth,
      clientHeight: this.view.scrollDOM.clientHeight,
      clientWidth: this.view.scrollDOM.clientWidth
    };
  }

  scrollTo(left, top) {
    if (left !== null && left !== undefined) this.view.scrollDOM.scrollLeft = left;
    if (top !== null && top !== undefined) this.view.scrollDOM.scrollTop = top;
  }

  heightAtLine(lineNumber) {
    const line = this.view.state.doc.line(Math.min(lineNumber + 1, this.lineCount()));
    return this.view.lineBlockAt(line.from).top;
  }

  cursorCoords(position, mode = 'page') {
    const offset = position == null
      ? this.view.state.selection.main.head
      : normalizeLineCh(this.view.state, position);
    const rect = this.view.coordsAtPos(offset) || this.view.dom.getBoundingClientRect();
    if (mode !== 'local') return rect;
    const editorRect = this.view.dom.getBoundingClientRect();
    return {
      left: rect.left - editorRect.left,
      right: rect.right - editorRect.left,
      top: rect.top - editorRect.top,
      bottom: rect.bottom - editorRect.top
    };
  }

  scrollIntoView(range, margin = 0) {
    const position = range?.from ?? range;
    this.view.dispatch({
      effects: EditorView.scrollIntoView(normalizeLineCh(this.view.state, position), {
        y: 'nearest',
        yMargin: margin
      })
    });
  }

  getWrapperElement() {
    return this.view.dom;
  }

  getScrollerElement() {
    return this.view.scrollDOM;
  }

  getInputField() {
    return this.view.contentDOM;
  }

  hasFocus() {
    return this.view.hasFocus;
  }

  focus() {
    this.view.focus();
  }

  refresh() {
    this.view.requestMeasure();
  }

  setLineNumbers(visible) {
    const nextVisible = Boolean(visible);
    if (nextVisible === this.lineNumbersVisible) return;
    this.lineNumbersVisible = nextVisible;
    this.view.dispatch({
      effects: this.lineNumbersCompartment.reconfigure(nextVisible ? lineNumbers() : [])
    });
  }
}

const Pass = Symbol('CodeMirror6.Pass');

function createEditor(textarea, options) {
  return new CodeMirror6Adapter(textarea, options);
}

module.exports = {
  CodeMirror6Adapter,
  Pass,
  createEditor
};
