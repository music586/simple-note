const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('heading fold control is hover-revealed and preserves per-editor state', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(renderer, /collapsedHeadings:\s*new Set\(\)/);
  assert.match(renderer, /cm-heading-toggle/);
  assert.match(renderer, /setBookmark/);
  assert.match(styles, /\.cm-heading-toggle\s*\{[^}]*opacity:\s*0/s);
  assert.match(styles, /CodeMirror-line:hover[^}]*cm-heading-toggle[^}]*opacity:\s*1/s);
});
