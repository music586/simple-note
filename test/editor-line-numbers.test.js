const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'codemirror6-adapter.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('feature settings include an accessible line number switch', () => {
  const featurePanel = html.slice(
    html.indexOf('id="settingsPanelFeatures"'),
    html.indexOf('id="settingsError"')
  );
  assert.match(featurePanel, /id="lineNumbersToggle"/);
  assert.match(featurePanel, /role="switch"/);
  assert.match(featurePanel, /aria-label="展示行号"/);
});

test('line number preference updates both editors and persists locally', () => {
  assert.match(renderer, /localStorage\.getItem\('line-numbers-enabled'\)/);
  assert.match(renderer, /editor\.codeMirror\.setLineNumbers\(lineNumbersEnabled\)/);
  assert.match(renderer, /editorRight\.codeMirror\.setLineNumbers\(lineNumbersEnabled\)/);
  assert.match(renderer, /localStorage\.setItem\('line-numbers-enabled'/);
});

test('CM6 line numbers are reconfigured without rebuilding the editor', () => {
  assert.match(adapter, /this\.lineNumbersCompartment = new Compartment\(\)/);
  assert.match(adapter, /this\.lineNumbersCompartment\.reconfigure/);
  assert.match(adapter, /setLineNumbers\(visible\)/);
  assert.match(styles, /\.cm-lineNumbers \.cm-gutterElement\s*\{/);
  assert.match(styles, /--editor-line-number: rgba\(151, 160, 181, 0\.42\)/);
  assert.match(styles, /--editor-line-number-active: rgba\(210, 216, 229, 0\.78\)/);
  assert.match(
    styles,
    /\.cm-scroller:has\(\.cm-lineNumbers\) \.cm-gutters\s*\{[^}]*margin-left:\s*max/s
  );
  assert.match(
    styles,
    /\.cm-scroller:has\(\.cm-lineNumbers\) \.cm-content\s*\{[^}]*margin-left:\s*0/s
  );
});
