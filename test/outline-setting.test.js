const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('settings include a persistent document outline switch', () => {
  assert.match(html, /id="outlineToggle"[^>]*role="switch"/);
  assert.match(renderer, /localStorage\.getItem\('outline-enabled'\) !== 'false'/);
  assert.match(renderer, /localStorage\.setItem\('outline-enabled', String\(outlineEnabled\)\)/);
  assert.match(renderer, /outlineToggle\.setAttribute\('aria-checked', String\(outlineEnabled\)\)/);
});

test('outline switch adds only an extra hiding condition', () => {
  assert.match(styles, /@container \(min-width: 1180px\)/);
  assert.match(styles, /\.editor-container\.preview-hidden \.document-outline/);
  assert.match(styles, /\.app\.outline-hidden \.document-outline\s*\{[^}]*display: none !important;/s);
});
