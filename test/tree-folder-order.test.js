const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf-8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf-8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf-8');

test('folder drag distinguishes sibling ordering from moving into a folder', () => {
  assert.match(renderer, /relativeY < 0\.34/);
  assert.match(renderer, /relativeY > 0\.66/);
  assert.match(renderer, /reorderFolder\(draggedItem\.path, folder\.path, placement\)/);
  assert.match(renderer, /moveItem\(draggedItem, folder\.path\)/);
});

test('folder order is saved per workspace and parent directory', () => {
  assert.match(main, /ipcMain\.handle\('reorder-folder'/);
  assert.match(main, /config\.folderOrders\[workspaceKey\]\[parentRelativePath\] = names/);
  assert.match(main, /getFolderOrder\(getConfig\(\), notesDir\)/);
});

test('folder ordering has distinct insertion feedback', () => {
  assert.match(styles, /\.tree-folder\.drag-reorder-before::after/);
  assert.match(styles, /\.tree-folder\.drag-reorder-after::after/);
});
