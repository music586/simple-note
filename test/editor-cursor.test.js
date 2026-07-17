const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('active Markdown headings use a centered text-height cursor', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

  assert.match(renderer, /cm-active-heading-/);
  assert.match(styles, /\.cm-active-heading-1 \.CodeMirror-cursor/);
  assert.match(styles, /height: 2\.35em !important/);
  assert.match(styles, /translateY\(1\.1em\)/);
});
