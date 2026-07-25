const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('storage locations dialog uses a simple header without window controls', () => {
  assert.doesNotMatch(html, /locations-window-controls|mac-window-control/);
  assert.doesNotMatch(html, /id="locationsClose"|class="locations-close"/);
  assert.match(html, /管理并切换简记使用的笔记库/);
  assert.doesNotMatch(styles, /\.mac-window-control/);
  assert.match(styles, /\.locations-modal-header\s*\{[^}]*justify-content: space-between;/s);
  assert.match(
    renderer,
    /locationsModal\.addEventListener\('click', event => \{\s*if \(event\.target === locationsModal\) locationsModal\.classList\.remove\('active'\)/
  );
});

test('storage locations are presented as separated lightweight cards', () => {
  assert.match(styles, /\.location-row\s*\{[^}]*border-radius: 11px;/s);
  assert.match(styles, /\.location-row \+ \.location-row\s*\{[^}]*margin-top: 7px;/s);
  assert.match(styles, /\.locations-footer\s*\{[^}]*border-top:/s);
});
