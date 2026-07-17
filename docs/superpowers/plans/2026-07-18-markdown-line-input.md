# Markdown Line Input Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an empty-line slash menu and predictable keyboard editing for Markdown headings, lists, task lists, and blockquotes without hiding source syntax.

**Architecture:** Put command metadata, fenced-code detection, line-context parsing, and text transformations in a small CommonJS module that can be tested without Electron. Keep DOM menu rendering and CodeMirror coordination in the renderer, with one menu instance shared by the left and right editor adapters. Apply every automatic edit through one CodeMirror operation so existing change, preview, decoration, and save flows remain intact.

**Tech Stack:** Electron 28, CommonJS JavaScript, CodeMirror 5, CSS custom properties, Node built-in `node:test` and `assert/strict`.

## Global Constraints

- Use 2-space indentation, single quotes, no trailing commas, and approximately 100-character lines.
- Keep all UI labels and empty/error messages in Chinese.
- Do not add third-party runtime or test dependencies.
- Trigger the slash menu only after `/` is typed at the start of an otherwise empty line.
- Disable slash commands and structure automation inside fenced code blocks.
- Preserve raw Markdown text and direct Markdown typing.
- Apply the same behavior to both editor panes.
- Fall back to CodeMirror defaults whenever the current structure is not recognized confidently.
- Preserve existing code-language completion, autosave, live preview, decorations, table editing, and paste behavior.

---

## File Map

- Create `markdown-structure.js`: pure command catalog, query filtering, fenced-code detection, line-context parsing, and edit descriptions for Enter/Tab/Shift+Tab/Backspace.
- Create `test/markdown-structure.test.js`: Node tests for all pure parsing, filtering, and transformation behavior.
- Modify `renderer.js`: create the shared slash menu, connect CodeMirror events, apply pure edit descriptions, and close the menu on lifecycle boundaries.
- Modify `index.html`: add one accessible slash-menu container after the editor layout.
- Modify `styles.css`: theme-aware menu positioning, rows, selected/empty states, and reduced-motion behavior.
- Modify `package.json`: expose `npm test` through Node's built-in test runner.

---

### Task 1: Command Catalog and Markdown Line Context

**Files:**
- Create: `markdown-structure.js`
- Create: `test/markdown-structure.test.js`
- Modify: `package.json:7-11`

**Interfaces:**
- Produces: `MARKDOWN_STRUCTURE_COMMANDS` array.
- Produces: `filterStructureCommands(query): Command[]`.
- Produces: `analyzeLineContext(lines, cursor): LineContext`.
- `Command` has `{ id, label, hint, prefix, keywords }`.
- `LineContext` has `{ line, ch, text, before, after, indent, inFence, type, marker, contentStart, number, emptyItem, slashQuery }`.

- [ ] **Step 1: Add the built-in test command**

Change the scripts block in `package.json` to:

```json
"scripts": {
  "start": "node scripts/launch.js",
  "dev": "node scripts/launch.js",
  "test": "node --test test/*.test.js",
  "dist:mac": "electron-builder --mac dmg --universal"
}
```

- [ ] **Step 2: Write failing catalog and filtering tests**

Create `test/markdown-structure.test.js` with:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKDOWN_STRUCTURE_COMMANDS,
  filterStructureCommands,
  analyzeLineContext
} = require('../markdown-structure');

test('catalog contains headings and line structures', () => {
  assert.deepEqual(
    MARKDOWN_STRUCTURE_COMMANDS.map(command => command.id),
    ['h1', 'h2', 'bullet', 'ordered', 'task', 'quote', 'h3', 'h4', 'h5', 'h6']
  );
});

test('filter matches Chinese, pinyin initials, and Markdown markers', () => {
  assert.equal(filterStructureCommands('任务')[0].id, 'task');
  assert.equal(filterStructureCommands('rw')[0].id, 'task');
  assert.equal(filterStructureCommands('-')[0].id, 'bullet');
  assert.deepEqual(
    filterStructureCommands('标题').map(command => command.id),
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  );
});
```

- [ ] **Step 3: Run the catalog tests and confirm the red state**

Run: `npm test -- --test-name-pattern='catalog|filter'`

Expected: FAIL with `Cannot find module '../markdown-structure'`.

- [ ] **Step 4: Implement the command catalog and filter**

Create the initial `markdown-structure.js`:

```javascript
const MARKDOWN_STRUCTURE_COMMANDS = [
  { id: 'h1', label: '一级标题', hint: '#', prefix: '# ', keywords: ['标题', 'bt', 'h1', '#'] },
  { id: 'h2', label: '二级标题', hint: '##', prefix: '## ', keywords: ['标题', 'bt', 'h2', '##'] },
  { id: 'bullet', label: '无序列表', hint: '-', prefix: '- ', keywords: ['无序', '列表', 'wx', 'lb', '-'] },
  { id: 'ordered', label: '有序列表', hint: '1.', prefix: '1. ', keywords: ['有序', '列表', 'yx', 'lb', '1.'] },
  { id: 'task', label: '任务列表', hint: '- [ ]', prefix: '- [ ] ', keywords: ['任务', '列表', 'rw', 'lb', '[]'] },
  { id: 'quote', label: '引用', hint: '>', prefix: '> ', keywords: ['引用', 'yy', '>'] },
  { id: 'h3', label: '三级标题', hint: '###', prefix: '### ', keywords: ['标题', 'bt', 'h3', '###'] },
  { id: 'h4', label: '四级标题', hint: '####', prefix: '#### ', keywords: ['标题', 'bt', 'h4', '####'] },
  { id: 'h5', label: '五级标题', hint: '#####', prefix: '##### ', keywords: ['标题', 'bt', 'h5', '#####'] },
  { id: 'h6', label: '六级标题', hint: '######', prefix: '###### ', keywords: ['标题', 'bt', 'h6', '######'] }
];

function filterStructureCommands(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return MARKDOWN_STRUCTURE_COMMANDS.slice(0, 6);
  return MARKDOWN_STRUCTURE_COMMANDS.filter(command => (
    command.label.includes(normalized)
      || command.id.includes(normalized)
      || command.keywords.some(keyword => keyword.toLowerCase().includes(normalized))
  ));
}

module.exports = {
  MARKDOWN_STRUCTURE_COMMANDS,
  filterStructureCommands
};
```

- [ ] **Step 5: Run the filtering tests and confirm green**

Run: `npm test -- --test-name-pattern='catalog|filter'`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 6: Write failing line-context tests**

Append to `test/markdown-structure.test.js`:

```javascript
test('slash query exists only at empty-line start and outside fences', () => {
  assert.equal(analyzeLineContext(['/rw'], { line: 0, ch: 3 }).slashQuery, 'rw');
  assert.equal(analyzeLineContext(['text /rw'], { line: 0, ch: 8 }).slashQuery, null);
  assert.equal(analyzeLineContext(['```', '/rw', '```'], { line: 1, ch: 3 }).slashQuery, null);
});

test('context recognizes supported line structures', () => {
  assert.equal(analyzeLineContext(['  - item'], { line: 0, ch: 8 }).type, 'bullet');
  assert.equal(analyzeLineContext(['3. item'], { line: 0, ch: 7 }).number, 3);
  assert.equal(analyzeLineContext(['- [x] done'], { line: 0, ch: 10 }).type, 'task');
  assert.equal(analyzeLineContext(['> > quote'], { line: 0, ch: 9 }).type, 'quote');
  assert.equal(analyzeLineContext(['## title'], { line: 0, ch: 8 }).type, 'heading');
});
```

- [ ] **Step 7: Run the context tests and confirm the red state**

Run: `npm test -- --test-name-pattern='slash query|context recognizes'`

Expected: FAIL because `analyzeLineContext` is not exported.

- [ ] **Step 8: Implement fenced-code and line-context analysis**

Add these functions before `module.exports` in `markdown-structure.js`, then export
`analyzeLineContext`:

```javascript
function isInsideFence(lines, targetLine) {
  let fence = null;
  for (let index = 0; index < targetLine; index += 1) {
    const match = lines[index].match(/^\s*(```+|~~~+)/);
    if (!match) continue;
    const marker = match[1][0];
    if (!fence) fence = marker;
    else if (fence === marker) fence = null;
  }
  return Boolean(fence);
}

function analyzeLineContext(lines, cursor) {
  const text = lines[cursor.line] || '';
  const before = text.slice(0, cursor.ch);
  const after = text.slice(cursor.ch);
  const indent = (text.match(/^\s*/) || [''])[0];
  const inFence = isInsideFence(lines, cursor.line);
  const slashMatch = !inFence ? before.match(/^\/(.*)$/) : null;
  const task = text.match(/^(\s*)- \[([ xX])\]\s?(.*)$/);
  const bullet = text.match(/^(\s*)[-+*]\s+(.*)$/);
  const ordered = text.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
  const quote = text.match(/^(\s*)((?:>\s*)+)(.*)$/);
  const heading = text.match(/^(\s*)#{1,6}\s+(.*)$/);
  let type = 'plain';
  let marker = '';
  let content = text.trim();
  let number = null;

  if (task) [type, marker, content] = ['task', `${task[1]}- [${task[2]}] `, task[3]];
  else if (bullet) [type, marker, content] = ['bullet', text.slice(0, text.length - bullet[2].length), bullet[2]];
  else if (ordered) {
    type = 'ordered';
    marker = text.slice(0, text.length - ordered[3].length);
    content = ordered[3];
    number = Number(ordered[2]);
  } else if (quote) [type, marker, content] = ['quote', `${quote[1]}${quote[2]}`, quote[3]];
  else if (heading) [type, marker, content] = ['heading', text.slice(0, text.length - heading[2].length), heading[2]];

  return {
    line: cursor.line,
    ch: cursor.ch,
    text,
    before,
    after,
    indent,
    inFence,
    type,
    marker,
    contentStart: marker.length,
    number,
    emptyItem: type !== 'plain' && !content.trim(),
    slashQuery: slashMatch ? slashMatch[1] : null
  };
}
```

- [ ] **Step 9: Run all Task 1 tests**

Run: `npm test`

Expected: 4 tests pass, 0 fail.

- [ ] **Step 10: Commit Task 1**

```bash
git add package.json markdown-structure.js test/markdown-structure.test.js
git commit -m 'feat: parse markdown line structures'
```

---

### Task 2: Pure Keyboard Transformations

**Files:**
- Modify: `markdown-structure.js`
- Modify: `test/markdown-structure.test.js`

**Interfaces:**
- Consumes: `analyzeLineContext(lines, cursor)` from Task 1.
- Produces: `getEnterEdit(context): Edit|null`.
- Produces: `getIndentEdit(context, direction): Edit|null` where direction is `1` or `-1`.
- Produces: `getBackspaceEdit(context): Edit|null`.
- `Edit` has `{ from: { line, ch }, to: { line, ch }, text, cursor: { line, ch } }`.

- [ ] **Step 1: Write failing Enter transformation tests**

Append:

```javascript
const {
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit
} = require('../markdown-structure');

test('Enter continues supported structures', () => {
  assert.equal(getEnterEdit(analyzeLineContext(['- item'], { line: 0, ch: 6 })).text, '\n- ');
  assert.equal(getEnterEdit(analyzeLineContext(['3. item'], { line: 0, ch: 7 })).text, '\n4. ');
  assert.equal(getEnterEdit(analyzeLineContext(['- [x] done'], { line: 0, ch: 10 })).text, '\n- [ ] ');
  assert.equal(getEnterEdit(analyzeLineContext(['> > quote'], { line: 0, ch: 9 })).text, '\n> > ');
  assert.equal(getEnterEdit(analyzeLineContext(['## title'], { line: 0, ch: 8 })).text, '\n');
});

test('Enter exits an empty structure item', () => {
  const edit = getEnterEdit(analyzeLineContext(['  - '], { line: 0, ch: 4 }));
  assert.deepEqual(edit.from, { line: 0, ch: 0 });
  assert.deepEqual(edit.to, { line: 0, ch: 4 });
  assert.equal(edit.text, '');
});
```

- [ ] **Step 2: Run Enter tests and confirm red**

Run: `npm test -- --test-name-pattern='Enter'`

Expected: FAIL because `getEnterEdit` is not exported.

- [ ] **Step 3: Implement Enter edits**

Add and export:

```javascript
function createEdit(context, fromCh, toCh, text, cursorLine, cursorCh) {
  return {
    from: { line: context.line, ch: fromCh },
    to: { line: context.line, ch: toCh },
    text,
    cursor: { line: cursorLine, ch: cursorCh }
  };
}

function getEnterEdit(context) {
  if (context.inFence || context.ch < context.contentStart) return null;
  if (!['heading', 'bullet', 'ordered', 'task', 'quote'].includes(context.type)) return null;
  if (context.emptyItem && context.type !== 'heading') {
    return createEdit(context, 0, context.text.length, '', context.line, 0);
  }
  let continuation = '';
  if (context.type === 'heading') continuation = '\n';
  if (context.type === 'bullet') continuation = `\n${context.indent}- `;
  if (context.type === 'ordered') continuation = `\n${context.indent}${context.number + 1}. `;
  if (context.type === 'task') continuation = `\n${context.indent}- [ ] `;
  if (context.type === 'quote') continuation = `\n${context.marker}`;
  return createEdit(
    context,
    context.ch,
    context.ch,
    continuation,
    context.line + 1,
    continuation.length - 1
  );
}
```

- [ ] **Step 4: Run Enter tests and confirm green**

Run: `npm test -- --test-name-pattern='Enter'`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Write failing indent and Backspace tests**

Append:

```javascript
test('Tab and Shift+Tab change list indentation by two spaces', () => {
  const context = analyzeLineContext(['- item'], { line: 0, ch: 2 });
  assert.equal(getIndentEdit(context, 1).text, '  ');
  const nested = analyzeLineContext(['  - item'], { line: 0, ch: 4 });
  assert.equal(getIndentEdit(nested, -1).text, '');
  assert.equal(getIndentEdit(analyzeLineContext(['plain'], { line: 0, ch: 2 }), 1), null);
});

test('Backspace outdents nested items before removing top-level markers', () => {
  const nested = getBackspaceEdit(analyzeLineContext(['  - item'], { line: 0, ch: 4 }));
  assert.deepEqual(nested.to, { line: 0, ch: 2 });
  const top = getBackspaceEdit(analyzeLineContext(['- item'], { line: 0, ch: 2 }));
  assert.deepEqual(top.to, { line: 0, ch: 2 });
  assert.equal(getBackspaceEdit(analyzeLineContext(['- item'], { line: 0, ch: 4 })), null);
});
```

- [ ] **Step 6: Run indent and Backspace tests and confirm red**

Run: `npm test -- --test-name-pattern='Tab|Backspace'`

Expected: FAIL because both transformation functions are missing.

- [ ] **Step 7: Implement indent and Backspace edits**

Add and export:

```javascript
function getIndentEdit(context, direction) {
  if (context.inFence || !['bullet', 'ordered', 'task'].includes(context.type)) return null;
  if (direction > 0) return createEdit(context, 0, 0, '  ', context.line, context.ch + 2);
  if (context.indent.length < 2) return null;
  return createEdit(context, 0, 2, '', context.line, Math.max(0, context.ch - 2));
}

function getBackspaceEdit(context) {
  if (context.inFence || context.ch !== context.contentStart) return null;
  if (!['heading', 'bullet', 'ordered', 'task', 'quote'].includes(context.type)) return null;
  if (['bullet', 'ordered', 'task'].includes(context.type) && context.indent.length >= 2) {
    return createEdit(context, 0, 2, '', context.line, context.ch - 2);
  }
  return createEdit(context, 0, context.contentStart, '', context.line, 0);
}
```

- [ ] **Step 8: Run all pure tests**

Run: `npm test`

Expected: 8 tests pass, 0 fail.

- [ ] **Step 9: Commit Task 2**

```bash
git add markdown-structure.js test/markdown-structure.test.js
git commit -m 'feat: add markdown structure key transforms'
```

---

### Task 3: Accessible Slash Command Menu

**Files:**
- Modify: `index.html:68-70`
- Modify: `styles.css` after CodeMirror editor styles near line 668
- Modify: `renderer.js:1-45`, `renderer.js:75-170`

**Interfaces:**
- Consumes: `filterStructureCommands(query)` and each command's `prefix`.
- Produces renderer-local `slashCommandMenu` with `open`, `update`, `move`, `select`, and `close` methods.
- Produces `applyCodeMirrorEdit(cm, edit): void` for Tasks 3 and 4.

- [ ] **Step 1: Add the single accessible menu container**

Insert immediately before the closing `.app` div in `index.html`:

```html
<div id="slashCommandMenu" class="slash-command-menu" role="listbox"
  aria-label="Markdown 结构" hidden></div>
```

- [ ] **Step 2: Add theme-aware menu styles**

Add to `styles.css`:

```css
.slash-command-menu {
  position: fixed;
  z-index: 1200;
  width: min(330px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 24px));
  overflow-y: auto;
  padding: 7px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 9px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
}

.slash-command-menu[hidden] { display: none; }
.slash-command-heading,
.slash-command-help,
.slash-command-empty { color: var(--text-secondary); font-size: 12px; }
.slash-command-heading { padding: 6px 10px; }
.slash-command-help { border-top: 1px solid var(--border-color); padding: 7px 9px 2px; }
.slash-command-empty { padding: 18px 10px; text-align: center; }
.slash-command-option {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  color: var(--text-primary);
  background: transparent;
  text-align: left;
}
.slash-command-option[aria-selected='true'] { background: var(--bg-hover); }
.slash-command-icon,
.slash-command-hint { font-family: 'Monaco', 'Menlo', 'Consolas', monospace; }
.slash-command-hint { color: var(--text-secondary); font-size: 11px; }
@media (prefers-reduced-motion: reduce) {
  .slash-command-menu { scroll-behavior: auto; }
}
```

- [ ] **Step 3: Import the pure module and create menu state**

Add near the existing imports in `renderer.js`:

```javascript
const {
  filterStructureCommands,
  analyzeLineContext,
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit
} = require('./markdown-structure');
```

After DOM lookups, create `slashCommandMenuElement` and a menu controller whose state is:

```javascript
const slashCommandMenuElement = document.getElementById('slashCommandMenu');
const slashCommandState = {
  editor: null,
  query: '',
  commands: [],
  selectedIndex: 0,
  composing: false
};
```

Implement `renderSlashCommandMenu()` by clearing with `replaceChildren()`, creating all labels
with `textContent`, assigning option ids `slash-command-${command.id}`, setting
`aria-selected`, and attaching `mousedown` with `event.preventDefault()` before selection.
Never construct command rows with `innerHTML`.

- [ ] **Step 4: Implement positioning and lifecycle methods**

Implement these exact behaviors in renderer-local functions:

```javascript
function positionSlashCommandMenu(cm) {
  const cursor = cm.cursorCoords(cm.getCursor(), 'window');
  const panel = cm.getWrapperElement().closest('.editor-panel').getBoundingClientRect();
  const menu = slashCommandMenuElement.getBoundingClientRect();
  const left = Math.min(Math.max(cursor.left, panel.left + 8), panel.right - menu.width - 8);
  const below = cursor.bottom + menu.height + 8 <= Math.min(panel.bottom, window.innerHeight);
  const top = below ? cursor.bottom + 4 : Math.max(panel.top + 8, cursor.top - menu.height - 4);
  slashCommandMenuElement.style.left = `${left}px`;
  slashCommandMenuElement.style.top = `${top}px`;
}

function closeSlashCommandMenu() {
  slashCommandState.editor = null;
  slashCommandState.query = '';
  slashCommandState.commands = [];
  slashCommandState.selectedIndex = 0;
  slashCommandMenuElement.hidden = true;
  slashCommandMenuElement.replaceChildren();
}
```

`openSlashCommandMenu(editorAdapter, query)` sets the active editor/query, filters commands,
renders, unhides, then positions. `moveSlashCommandSelection(delta)` wraps through available
commands and updates `aria-activedescendant`. `selectSlashCommand()` replaces `/query` on the
current line with the selected command prefix inside one `cm.operation`, restores focus, and
closes. With zero matches, Enter leaves input unchanged.

- [ ] **Step 5: Connect change and composition events for both editors**

Inside `createCodeEditor`, register CodeMirror `inputRead` to analyze the current line after
normal character input. Open/update only when `slashQuery !== null`, a current note exists for
that adapter, and composition is inactive. Close when the condition stops matching.

Register `compositionstart` and `compositionend` on `codeMirror.getInputField()` to toggle
`slashCommandState.composing`; on composition end, recompute the query once.

- [ ] **Step 6: Run automated regression tests**

Run: `npm test`

Expected: 8 tests pass, 0 fail.

- [ ] **Step 7: Perform focused Electron menu verification**

Run: `npm start`

Verify in both panes:

- Empty-line `/` opens six initial commands.
- `/任务`, `/rw`, and `/-` select the expected result.
- Arrow keys wrap, Enter inserts, Escape closes, and mouse selection preserves editor focus.
- `text /`, `https://`, a filesystem path, and fenced code do not open the menu.
- Near right/bottom edges, the menu remains inside the active panel and flips above the cursor.
- During Chinese IME composition, Enter confirms IME text instead of selecting a command.

- [ ] **Step 8: Commit Task 3**

```bash
git add index.html styles.css renderer.js
git commit -m 'feat: add markdown slash command menu'
```

---

### Task 4: CodeMirror Structure Key Handling

**Files:**
- Modify: `renderer.js:75-170`, editor lifecycle handlers near lines 1840-1955

**Interfaces:**
- Consumes: all pure edit functions from Tasks 1 and 2.
- Consumes: slash menu lifecycle from Task 3.
- Produces: identical Enter/Tab/Shift+Tab/Backspace behavior in both editor adapters.

- [ ] **Step 1: Add the shared edit applicator and context reader**

Add renderer-local helpers:

```javascript
function getCodeMirrorContext(cm) {
  const lines = Array.from({ length: cm.lineCount() }, (_, line) => cm.getLine(line));
  return analyzeLineContext(lines, cm.getCursor());
}

function applyCodeMirrorEdit(cm, edit) {
  if (!edit) return false;
  cm.operation(() => {
    cm.replaceRange(edit.text, edit.from, edit.to, '+markdown-structure');
    cm.setCursor(edit.cursor);
  });
  return true;
}
```

- [ ] **Step 2: Replace the Enter handler with ordered dispatch**

The Enter key handler must execute in this order:

```javascript
Enter: cm => {
  if (!slashCommandMenuElement.hidden && slashCommandState.editor === editorAdapter) {
    selectSlashCommand();
    return;
  }
  if (slashCommandState.composing) return CodeMirror.Pass;
  if (handleOpeningCodeFence(cm, editorAdapter)) return;
  if (applyCodeMirrorEdit(cm, getEnterEdit(getCodeMirrorContext(cm)))) return;
  cm.execCommand('newlineAndIndent');
}
```

Extract the existing lines 89-110 code-fence logic to
`handleOpeningCodeFence(cm, editorAdapter): boolean` without changing its matching, menu IPC,
pending state, or cursor-coordinate behavior.

- [ ] **Step 3: Add menu navigation and structure keys**

Add these CodeMirror `extraKeys` entries:

```javascript
'Up': cm => handleMenuMove(cm, -1),
'Down': cm => handleMenuMove(cm, 1),
'Esc': cm => handleMenuEscape(cm),
'Tab': cm => applyCodeMirrorEdit(cm, getIndentEdit(getCodeMirrorContext(cm), 1))
  || CodeMirror.Pass,
'Shift-Tab': cm => applyCodeMirrorEdit(cm, getIndentEdit(getCodeMirrorContext(cm), -1))
  || CodeMirror.Pass,
'Backspace': cm => applyCodeMirrorEdit(cm, getBackspaceEdit(getCodeMirrorContext(cm)))
  || CodeMirror.Pass
```

`handleMenuMove` and `handleMenuEscape` return `CodeMirror.Pass` when the menu is closed or
belongs to the other editor. Escape closes without deleting `/query`. All handlers return
CodeMirror.Pass inside fenced code except the unchanged opening-fence completion behavior.

- [ ] **Step 4: Close stale menu state at lifecycle boundaries**

Call `closeSlashCommandMenu()` when:

- CodeMirror emits `scroll` or `blur`.
- `openInRightPanel` changes the right note.
- `closeRightPanel` begins.
- The left-note loading function changes `currentNote`.
- A reading/view mode hides the active editor.

Do not close on a menu option's `mousedown`; that handler prevents the CodeMirror blur first.

- [ ] **Step 5: Run automated tests**

Run: `npm test`

Expected: 8 tests pass, 0 fail.

- [ ] **Step 6: Verify keyboard behavior in Electron**

Run: `npm start`

Verify in left and right panes:

- Heading Enter produces a plain new line.
- Bullet and quote Enter preserve their marker and indentation.
- Ordered Enter increments only the new item.
- Completed and incomplete task items both create `- [ ] `.
- Enter on an empty item removes its marker; one undo restores the complete action.
- Tab/Shift+Tab adjust lists by exactly two spaces; outside lists they retain CodeMirror defaults.
- Backspace at nested content start outdents; at top level it removes only the marker.
- Code-fence language selection and Enter inside code fences behave as before.
- Preview and save still update after every automatic edit.

- [ ] **Step 7: Commit Task 4**

```bash
git add renderer.js
git commit -m 'feat: add markdown structure keyboard editing'
```

---

### Task 5: Full Regression and Packaging Check

**Files:**
- Modify only files needed to correct failures found by the commands below.

**Interfaces:**
- Consumes the completed feature from Tasks 1-4.
- Produces a verified feature with no known regression in existing note workflows.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass, 0 fail.

- [ ] **Step 2: Check JavaScript syntax**

Run:

```bash
node --check markdown-structure.js
node --check renderer.js
node --check main.js
```

Expected: all three commands exit 0 with no output.

- [ ] **Step 3: Check whitespace and inspect scope**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: `git diff --check` exits 0; status contains no uncommitted application changes;
the commit range contains only `markdown-structure.js`, its test, `renderer.js`, `index.html`,
`styles.css`, and `package.json`.

- [ ] **Step 4: Run final application smoke test**

Run: `npm start`

Verify creating, editing, renaming, switching, previewing, and saving a note; then repeat slash
menu and structure-key checks once in each pane under both light and dark themes.

- [ ] **Step 5: Commit any verification-only corrections**

If Steps 1-4 required a code correction, rerun the failing check and then run `npm test`. Commit
only the corrected files with:

```bash
git add markdown-structure.js test/markdown-structure.test.js renderer.js index.html styles.css package.json
git commit -m 'fix: harden markdown structure input'
```

If no correction was required, do not create an empty commit.
