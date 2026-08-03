const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'styles.css'),
  'utf8'
);

test('multi-line selections stay inside the editor reading area', () => {
  assert.match(
    styles,
    /\.editor-pane > \.cm-editor \.cm-content\s*\{[^}]*flex-grow: 0;[^}]*flex-basis: var\(--editor-page-width\);[^}]*width: min\(100%, var\(--editor-page-width\)\);[^}]*margin-right: auto;[^}]*margin-left: auto;[^}]*overflow-x: clip;/s
  );
});
