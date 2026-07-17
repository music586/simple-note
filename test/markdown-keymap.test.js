const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyCodeMirrorEdit,
  createMarkdownKeyHandlers
} = require('../markdown-keymap');

const Pass = Symbol('CodeMirror.Pass');

function createCm(selected = false) {
  const calls = [];
  return {
    calls,
    somethingSelected: () => selected,
    execCommand: command => calls.push(['execCommand', command]),
    operation: callback => {
      calls.push(['operation']);
      callback();
    },
    replaceRange: (...args) => calls.push(['replaceRange', ...args]),
    setCursor: cursor => calls.push(['setCursor', cursor])
  };
}

function createHarness(overrides = {}) {
  const adapter = { id: 'left' };
  const otherAdapter = { id: 'right' };
  const calls = [];
  let menuState = {
    hidden: true,
    editor: null,
    composing: false,
    commands: []
  };
  const context = { type: 'bullet' };
  const edit = {
    text: '\n- ',
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
    cursor: { line: 1, ch: 2 }
  };
  const dependencies = {
    Pass,
    getMenuState: () => menuState,
    selectSlashCommand: () => calls.push('select'),
    moveSlashCommandSelection: delta => calls.push(['move', delta]),
    closeSlashCommandMenu: () => calls.push('close'),
    handleOpeningCodeFence: () => false,
    getContext: () => {
      calls.push('context');
      return context;
    },
    getEnterEdit: value => {
      calls.push(['enterEdit', value]);
      return edit;
    },
    getIndentEdit: (value, direction) => {
      calls.push(['indentEdit', value, direction]);
      return edit;
    },
    getBackspaceEdit: value => {
      calls.push(['backspaceEdit', value]);
      return edit;
    },
    applyEdit: (cm, value) => {
      calls.push(['apply', value]);
      return Boolean(value);
    },
    ...overrides
  };
  const createHandlers = createMarkdownKeyHandlers(dependencies);

  return {
    adapter,
    otherAdapter,
    calls,
    edit,
    handlers: createHandlers(adapter),
    otherHandlers: createHandlers(otherAdapter),
    setMenuState(value) {
      menuState = { ...menuState, ...value };
    }
  };
}

test('applyCodeMirrorEdit applies one isolated CodeMirror operation', () => {
  const cm = createCm();
  const edit = {
    text: '- ',
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 0 },
    cursor: { line: 0, ch: 2 }
  };

  assert.equal(applyCodeMirrorEdit(cm, null), false);
  assert.equal(applyCodeMirrorEdit(cm, edit), true);
  assert.deepEqual(cm.calls, [
    ['operation'],
    ['replaceRange', edit.text, edit.from, edit.to, 'markdown-structure'],
    ['setCursor', edit.cursor]
  ]);
});

test('selection falls back without reading or applying structure context', () => {
  const harness = createHarness();
  const cm = createCm(true);

  assert.equal(harness.handlers.Enter(cm), undefined);
  assert.equal(harness.handlers.Tab(cm), Pass);
  assert.equal(harness.handlers['Shift-Tab'](cm), Pass);
  assert.equal(harness.handlers.Backspace(cm), Pass);
  assert.deepEqual(cm.calls, [['execCommand', 'newlineAndIndent']]);
  assert.deepEqual(harness.calls, []);
});

test('Enter dispatches owned menu, composition, opening fence, structure, then fallback', () => {
  const owned = createHarness();
  const cm = createCm();
  owned.setMenuState({ hidden: false, editor: owned.adapter, commands: [{}] });
  owned.handlers.Enter(cm);
  assert.deepEqual(owned.calls, ['select']);

  const composing = createHarness();
  composing.setMenuState({ composing: true });
  assert.equal(composing.handlers.Enter(createCm()), Pass);

  const fence = createHarness({ handleOpeningCodeFence: () => true });
  assert.equal(fence.handlers.Enter(createCm()), undefined);
  assert.deepEqual(fence.calls, []);

  const structure = createHarness();
  structure.handlers.Enter(createCm());
  assert.deepEqual(structure.calls, [
    'context',
    ['enterEdit', { type: 'bullet' }],
    ['apply', structure.edit]
  ]);

  const fallback = createHarness({ getEnterEdit: () => null });
  const fallbackCm = createCm();
  fallback.handlers.Enter(fallbackCm);
  assert.deepEqual(fallbackCm.calls, [['execCommand', 'newlineAndIndent']]);
});

test('menu navigation requires ownership and results for either adapter', () => {
  const harness = createHarness();
  const cm = createCm();

  assert.equal(harness.handlers.Up(cm), Pass);
  harness.setMenuState({ hidden: false, editor: harness.otherAdapter, commands: [{}] });
  assert.equal(harness.handlers.Down(cm), Pass);
  harness.setMenuState({ editor: harness.adapter, commands: [] });
  assert.equal(harness.handlers.Up(cm), Pass);
  harness.setMenuState({ commands: [{}] });
  assert.equal(harness.handlers.Up(cm), undefined);
  assert.equal(harness.handlers.Down(cm), undefined);
  assert.equal(harness.handlers.Esc(cm), undefined);
  assert.deepEqual(harness.calls, [['move', -1], ['move', 1], 'close']);

  harness.setMenuState({ editor: harness.otherAdapter });
  assert.equal(harness.otherHandlers.Esc(cm), undefined);
  assert.equal(harness.handlers.Esc(cm), Pass);
});

test('structure keys apply edits or return CodeMirror.Pass', () => {
  const harness = createHarness();
  const cm = createCm();

  assert.equal(harness.handlers.Tab(cm), true);
  assert.equal(harness.handlers['Shift-Tab'](cm), true);
  assert.equal(harness.handlers.Backspace(cm), true);

  const fallback = createHarness({
    getIndentEdit: () => null,
    getBackspaceEdit: () => null
  });
  assert.equal(fallback.handlers.Tab(cm), Pass);
  assert.equal(fallback.handlers['Shift-Tab'](cm), Pass);
  assert.equal(fallback.handlers.Backspace(cm), Pass);
});

test('packaged renderer includes its keymap and structure dependencies', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json')));

  assert.ok(packageJson.build.files.includes('markdown-keymap.js'));
  assert.ok(packageJson.build.files.includes('markdown-structure.js'));
});
