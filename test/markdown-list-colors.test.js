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

test('nested unordered list markers use a font-independent hollow circle', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(renderer, /classList\.toggle\('is-nested', Boolean\([^)]*\.nested\)\)/);
  assert.match(
    styles,
    /\.cm-rendered-bullet\.is-nested::before\s*\{[^}]*border: 1\.4px solid currentColor/s
  );
  assert.match(styles, /\.cm-rendered-bullet\.is-nested::before\s*\{[^}]*border-radius: 50%/s);
  assert.match(
    styles,
    /\.cm-rendered-bullet\.is-nested::before\s*\{[^}]*top: 50%;[^}]*left: 50%;/s
  );
  assert.match(styles, /transform: translate\(-50%, -50%\)/);
  assert.match(renderer, /function createRenderedListMarker\(listPrefix\)/);
  assert.match(renderer, /listPrefix\.nested \? '' : listPrefix\.label/);
  assert.match(renderer, /createRenderedListMarker\(activeListPrefix\)/);
  assert.match(renderer, /createRenderedListMarker\(listPrefix\)/);
});

test('checked task controls follow the selected accent theme', () => {
  assert.match(styles, /:root\[data-accent\] \{[^}]*--md-task-checked: var\(--accent-color\)/s);
  assert.match(styles, /\.cm-rendered-checkbox\.is-checked\s*\{[^}]*var\(--md-task-checked\)/s);
  assert.match(styles, /accent-color: var\(--md-task-checked\)/);
  assert.match(styles, /\.cm-task-completed-text,[\s\S]*text-decoration: line-through/);
  assert.match(
    styles,
    /\.preview-content li\.task-list-item:has\(> input\[type='checkbox'\]:checked\)/
  );
});

test('task checkmark stays centered inside its square at every scale', () => {
  assert.match(
    styles,
    /\.cm-rendered-checkbox\.is-checked::after \{[^}]*top: 50%;[^}]*left: 50%;/s
  );
  assert.match(styles, /transform: translate\(-50%, -56%\) rotate\(42deg\)/);
  assert.match(styles, /transform-origin: center/);
  assert.doesNotMatch(styles, /\.cm-rendered-checkbox\.is-checked::after \{[^}]*left: 3px/s);
});

test('success callouts keep an independent semantic green', () => {
  assert.match(styles, /--md-success: #67c7ae;/);
  assert.match(styles, /--md-success: #218a72;/);
  assert.match(styles, /\.cm-callout-widget\.is-success,[\s\S]*var\(--md-success\)/);
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
