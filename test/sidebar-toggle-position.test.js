const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('sidebar toggle moves to the sidebar edge only while the sidebar is open', () => {
  assert.match(styles, /\.sidebar-header #toggleSidebarBtn/);
  assert.match(renderer, /const destination = expanded \? sidebarHeader : leftToolbar/);
  assert.match(renderer, /if \(expanded\) destination\.appendChild\(toggleSidebarBtn\)/);
  assert.match(renderer, /else destination\.prepend\(toggleSidebarBtn\)/);
  assert.doesNotMatch(styles, /#toggleSidebarBtn[^{]*\{[^}]*position: absolute/s);
});

test('sidebar toggle exposes its expanded state', () => {
  assert.match(renderer, /setAttribute\('aria-expanded', String\(!sidebarHidden\)\)/);
  assert.match(renderer, /setAttribute\('aria-expanded', String\(readingSidebarVisible\)\)/);
});

test('sidebar expansion uses a restrained motion sequence', () => {
  assert.match(styles, /--sidebar-collapse-duration: 420ms/);
  assert.match(styles, /--sidebar-collapse-easing: cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(styles, /\.app\.sidebar-transitioning \.sidebar/);
  assert.match(styles, /will-change: width;/);
  assert.doesNotMatch(
    styles,
    /\.app\.sidebar-transitioning \.sidebar\s*\{[^}]*will-change: width, min-width/s
  );
  assert.match(styles, /\.app\.sidebar-transitioning[^{]*\.CodeMirror-vscrollbar/);
  assert.match(styles, /transform: translateX\(-14px\)/);
  assert.match(renderer, /function beginSidebarTransition\(\)/);
  assert.match(renderer, /classList\.add\('sidebar-toggle-relocating'\)/);
  assert.match(renderer, /prefers-reduced-motion: reduce/);
});
