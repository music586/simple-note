const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('sidebar toggle moves to the sidebar edge only while the sidebar is open', () => {
  assert.match(styles, /\.sidebar-header #toggleSidebarBtn/);
  assert.match(renderer, /sidebarHeader\.appendChild\(toggleSidebarBtn\)/);
  assert.match(renderer, /leftToolbar\.prepend\(toggleSidebarBtn\)/);
  assert.doesNotMatch(styles, /#toggleSidebarBtn[^{]*\{[^}]*position: absolute/s);
});

test('sidebar toggle exposes its expanded state', () => {
  assert.match(renderer, /setAttribute\('aria-expanded', String\(!sidebarHidden\)\)/);
  assert.match(renderer, /setAttribute\('aria-expanded', String\(readingSidebarVisible\)\)/);
});
