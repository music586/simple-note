const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('code fence language picker contains a searchable listbox', () => {
  assert.match(html, /id="codeLanguagePicker"[^>]*class="code-language-picker"/);
  assert.match(html, /id="codeLanguageSearch"[^>]*placeholder="筛选语言"/);
  assert.match(html, /id="codeLanguageResults"[^>]*role="listbox"/);
  assert.match(renderer, /function filterCodeLanguages\(query\)/);
  assert.match(renderer, /language\.keywords\.some\(keyword => keyword\.includes\(normalizedQuery\)\)/);
  assert.match(renderer, /codeLanguageSearch\.addEventListener\('input'/);
  assert.match(styles, /\.code-language-picker\s*\{/);
});

test('code language picker supports keyboard selection and dismissal', () => {
  assert.match(renderer, /event\.key === 'ArrowDown'/);
  assert.match(renderer, /event\.key === 'ArrowUp'/);
  assert.match(renderer, /event\.key === 'Enter'/);
  assert.match(renderer, /event\.key === 'Escape'/);
  assert.match(renderer, /selectCodeLanguage\(selected\.language\)/);
  assert.match(renderer, /closeCodeLanguagePicker\(\)/);
  assert.match(renderer, /showCodeLanguagePicker\(editorAdapter, cursorPosition\)/);
});

test('selecting a language focuses the editable content inside the rendered code block', () => {
  assert.match(renderer, /pendingCodeFocusEditor = \{[\s\S]*editor: pending\.editor/);
  assert.match(
    renderer,
    /scheduleEditorDecorations\(pending\.editor, \(\) => targetNote\)/
  );
  assert.match(renderer, /const codeElement = widget\.querySelector\('code\[contenteditable\]'\)/);
  assert.match(renderer, /focusEditableAtStart\(codeElement\)/);
  assert.match(renderer, /setTimeout\(focusCodeEditor, 50\)/);
  assert.match(
    renderer,
    /document\.activeElement === codeElement[\s\S]*pendingCodeFocusEditor = null/
  );

  const applySelection = renderer.match(
    /function applySelectedCodeLanguage\(pending, language\) \{([\s\S]*?)\n\}/
  );
  assert.ok(applySelection);
  assert.doesNotMatch(applySelection[1], /codeMirror\.focus\(\)/);
});

test('code block text supports native selection while preserving editor scroll', () => {
  assert.match(renderer, /function focusCodeWidgetWithoutScroll\(widget, target, focus\)/);
  assert.match(renderer, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(renderer, /scroller\.scrollTop = scrollTop/);
  assert.match(renderer, /requestAnimationFrame\(restoreScroll\)/);
  const codeMouseHandler = renderer.match(
    /codeElement\.addEventListener\('mousedown', event => \{([\s\S]*?)\n  \}\);/
  );
  assert.ok(codeMouseHandler);
  assert.match(codeMouseHandler[1], /event\.stopPropagation\(\)/);
  assert.doesNotMatch(codeMouseHandler[1], /event\.preventDefault\(\)/);
  assert.doesNotMatch(codeMouseHandler[1], /placeCaretInTableCell/);
  assert.match(styles, /\.cm-code-widget code\.hljs\s*\{[^}]*user-select: text;/s);
  assert.match(styles, /\.cm-code-widget code\.hljs\s*\{[^}]*cursor: text;/s);
});
