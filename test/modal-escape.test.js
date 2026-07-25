const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(
  path.join(__dirname, '..', 'renderer.js'),
  'utf8'
);

test('Escape closes only the topmost active modal', () => {
  const closeStart = renderer.indexOf('function closeTopmostModal()');
  const closeEnd = renderer.indexOf("document.addEventListener('keydown'", closeStart);
  const closeSource = renderer.slice(closeStart, closeEnd);

  assert.ok(closeStart >= 0);
  assert.match(closeSource, /confirmModal\.classList\.contains\('active'\)/);
  assert.match(closeSource, /modal\.classList\.contains\('active'\)/);
  assert.match(closeSource, /templateModal\.classList\.contains\('active'\)/);
  assert.match(closeSource, /settingsModal\.classList\.contains\('active'\)/);
  assert.match(closeSource, /locationsModal\.classList\.contains\('active'\)/);
  assert.match(closeSource, /else if/);
});

test('unified Escape handling prevents lower-priority keyboard actions', () => {
  assert.match(
    renderer,
    /event\.key !== 'Escape' \|\| !closeTopmostModal\(\)[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopImmediatePropagation\(\);/
  );
  assert.match(
    renderer,
    /else if \(event\.key === 'Escape' && !editorFindBar\.hidden\) \{\s*if \(document\.querySelector\('\.modal\.active'\)\) return;/
  );
  assert.match(
    renderer,
    /document\.addEventListener\('keydown', \(event\) => \{\s*if \(document\.querySelector\('\.modal\.active'\)\) return;/
  );
});
