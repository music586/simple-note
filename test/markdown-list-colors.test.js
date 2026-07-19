const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('list markers use a structural color distinct from links in both themes', () => {
  assert.match(styles, /--md-accent: #9299f7;[\s\S]*--md-list: #67c7ae;/);
  assert.match(styles, /--md-accent: #5d64ce;[\s\S]*--md-list: #218a72;/);
  assert.match(styles, /\.cm-rendered-list-marker\s*\{[^}]*color: var\(--md-list\)/s);
  assert.match(styles, /\.preview-content li::marker\s*\{[^}]*color: var\(--md-list\)/s);
});

test('links keep their interaction color and visible underline treatment', () => {
  assert.match(styles, /\.preview-content a\s*\{[^}]*color: var\(--md-accent\)/s);
  assert.match(styles, /text-decoration-color: color-mix\(in srgb, var\(--md-accent\)/);
  assert.match(styles, /\.preview-content a:hover\s*\{[^}]*var\(--md-accent\)/s);
});

test('task completion uses the list color instead of the link color', () => {
  assert.match(styles, /\.cm-rendered-checkbox\.is-checked\s*\{[^}]*var\(--md-list\)/s);
  assert.match(styles, /accent-color: var\(--md-list\)/);
});
