const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('editable note names are displayed in the content heading row', () => {
  assert.equal((html.match(/class="note-heading-row(?: [^"]*)?"/g) || []).length, 2);
  assert.doesNotMatch(html, /id="noteTitle"[^>]*readonly/);
  assert.doesNotMatch(html, /id="noteTitleRight"[^>]*readonly/);
  assert.match(styles, /\.note-heading-row \{[^}]*background: var\(--bg-primary\)/s);
  assert.match(
    styles,
    /\.note-heading-row \{[^}]*padding-left: max\([^}]*var\(--editor-page-width\)/s
  );
  assert.match(styles, /\.note-heading-row \.note-title-input \{[^}]*text-align: left;/s);
  assert.match(html, /class="note-heading-row note-heading-row-right"/);
  assert.match(
    styles,
    /#leftPanel \.note-heading-row #noteTitle,\s*#rightPanel \.note-heading-row-right #noteTitleRight\s*\{[^}]*text-align: left;/s
  );
});

test('enter confirms edited note names', () => {
  assert.match(renderer, /noteTitle\.addEventListener\('keydown'/);
  assert.match(renderer, /if \(event\.key === 'Enter'\) noteTitle\.blur\(\)/);
  assert.match(renderer, /if \(event\.key === 'Enter'\) noteTitleRight\.blur\(\)/);
});

test('top toolbars match the content background', () => {
  assert.match(styles, /\.toolbar \{\s*background: var\(--bg-primary\);\s*\}/);
});
