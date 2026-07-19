const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('top bars use the compact final height', () => {
  assert.match(styles, /\/\* Compact application top bar \*\/[\s\S]*--header-height: 42px/);
  assert.match(styles, /--title-control-height: 28px/);
  assert.match(styles, /\.sidebar-header\s*\{[^}]*padding-top: 0;[^}]*padding-bottom: 0;/s);
});

test('top bar dividers are hidden until the region is hovered', () => {
  assert.match(styles, /\.sidebar-header,\s*\.toolbar\s*\{[^}]*border-bottom: 1px solid transparent;/s);
  assert.match(
    styles,
    /\.app\.topbar-hovered::after\s*\{[^}]*opacity: 1;/s
  );
  assert.match(renderer, /ipcRenderer\.on\('topbar-hover-changed'/);
  assert.match(
    styles,
    /:root\[data-theme='light'\] \.sidebar-header,\s*:root\[data-theme='light'\] \.toolbar\s*\{[^}]*border-bottom-color: transparent;/s
  );
  assert.match(
    styles,
    /:root\[data-theme='light'\] \.app::after/
  );
});

test('native top bar dragging and system cursor hover tracking work together', () => {
  assert.match(styles, /\.sidebar-header,\s*\.toolbar\s*\{\s*-webkit-app-region: drag;/s);
  assert.match(main, /screen\.getCursorScreenPoint\(\)/);
  assert.match(main, /cursor\.y < bounds\.y \+ 42/);
  assert.match(renderer, /ipcRenderer\.on\('topbar-hover-changed'/);
  assert.doesNotMatch(renderer, /window\.addEventListener\('pointermove', updateTopbarHover\)/);
});
