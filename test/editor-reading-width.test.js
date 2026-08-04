const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('普通编辑区使用适合长文阅读的页宽', () => {
  assert.match(
    styles,
    /:root\s*\{[^}]*--editor-page-width:\s*760px;/s
  );
  assert.match(
    styles,
    /\.editor-pane > \.cm-editor \.cm-content\s*\{[^}]*flex-basis:\s*var\(--editor-page-width\);[^}]*width:\s*min\(100%, var\(--editor-page-width\)\);/s
  );
});

test('标题、预览和行号继续与正文页宽对齐', () => {
  assert.match(
    styles,
    /\.note-heading-row\s*\{[^}]*var\(--editor-page-width\)/s
  );
  assert.match(
    styles,
    /\.preview-content\s*\{[^}]*var\(--editor-page-width\)/s
  );
  assert.match(
    styles,
    /\.editor-pane > \.cm-editor\s*\{[^}]*--editor-active-page-width:\s*var\(--editor-page-width\);/s
  );
});
