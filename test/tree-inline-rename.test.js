const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('tree rename replaces the item label with a selected inline input', () => {
  assert.match(renderer, /function renameItem\(data\)/);
  assert.match(renderer, /nameElement\.replaceWith\(input\)/);
  assert.match(renderer, /input\.focus\(\);\s*input\.select\(\)/);
  assert.match(styles, /\.tree-rename-input \{[^}]*border: 0;[^}]*border-bottom: 1px solid/s);
  assert.match(styles, /\.tree-rename-input::selection \{[^}]*var\(--selection-bg\)/s);
});

test('inline tree rename saves on enter or blur and cancels on escape', () => {
  assert.match(renderer, /input\.addEventListener\('blur', \(\) => finish\(true\)\)/);
  assert.match(renderer, /event\.key === 'Enter'[\s\S]*?finish\(true\)/);
  assert.match(renderer, /event\.key === 'Escape'[\s\S]*?finish\(false\)/);
});

test('renaming a folder keeps open notes and expanded folders on the new path', () => {
  assert.match(renderer, /function syncRenamedFolderPaths\(oldPath, renamedFolder\)/);
  assert.match(renderer, /currentNoteRight\.path = replaceTreePathPrefix/);
  assert.match(renderer, /expandedFolders = new Set\(\[\.\.\.expandedFolders\]\.map/);
});
