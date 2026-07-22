const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('list markers and unchecked task controls use the body color', () => {
  assert.match(styles, /\.cm-formatting-list\s*\{[^}]*color: var\(--md-body\)/s);
  assert.match(styles, /\.cm-variable-2,[\s\S]*?\.cm-variable-3\s*\{[^}]*var\(--md-body\)/s);
  assert.match(styles, /\.cm-rendered-list-line \.cm-comment\s*\{[^}]*var\(--md-body\)/s);
  assert.match(styles, /\.cm-rendered-list-marker\s*\{[^}]*color: var\(--md-body\)/s);
  assert.match(styles, /\.preview-content li::marker\s*\{[^}]*color: var\(--md-body\)/s);
  assert.match(styles, /\.cm-rendered-checkbox\s*\{[^}]*border-color: var\(--md-body\)/s);
});

test('checked task controls use the dedicated completion color', () => {
  assert.match(styles, /--md-task-checked: #67c7ae;/);
  assert.match(styles, /--md-task-checked: #218a72;/);
  assert.match(styles, /\.cm-rendered-checkbox\.is-checked\s*\{[^}]*var\(--md-task-checked\)/s);
  assert.match(styles, /accent-color: var\(--md-task-checked\)/);
});

test('links keep their interaction color and visible underline treatment', () => {
  assert.match(styles, /\.preview-content a\s*\{[^}]*color: var\(--md-accent\)/s);
  assert.match(styles, /text-decoration-color: color-mix\(in srgb, var\(--md-accent\)/);
  assert.match(styles, /\.preview-content a:hover\s*\{[^}]*var\(--md-accent\)/s);
});

test('syntax uses the muted color and code uses the accent color', () => {
  assert.match(styles, /\.cm-formatting[^}]*color: var\(--md-muted\)/s);
  assert.match(styles, /\.cm-inline-code\s*\{[^}]*color: var\(--md-accent\)/s);
  assert.doesNotMatch(styles, /--md-(?:list|syntax|code):/);
});
