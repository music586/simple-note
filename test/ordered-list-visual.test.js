const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ordered list editor and preview preserve the natural source position', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(styles, /\.cm-rendered-ordered\s*\{[^}]*font-family:\s*inherit/s);
  assert.match(styles, /\.cm-rendered-ordered\s*\{[^}]*font-size:\s*inherit/s);
  assert.match(styles, /\.cm-rendered-ordered\s*\{[^}]*margin:\s*0/s);
  assert.match(styles, /\.preview-content ol\s*\{[^}]*padding-left:\s*0/s);
  assert.match(styles, /\.preview-content ol\s*\{[^}]*list-style-position:\s*inside/s);
  assert.match(styles, /\.preview-content ol\s*\{[^}]*line-height:\s*1\.8/s);
  assert.match(renderer, /listPrefix\.type === 'ordered'\s*\? `\$\{listPrefix\.label\} `/);
  assert.match(renderer, /activeListPrefix\?\.type === 'ordered'/);
  assert.match(renderer, /className = 'cm-rendered-list-marker cm-rendered-ordered'/);
});
