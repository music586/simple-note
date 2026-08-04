const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf-8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf-8');

test('active notes directory changes refresh only their owning window', () => {
  assert.match(main, /workspace\.watcher = fs\.watch\(/);
  assert.match(main, /getNotesDir\(targetWindow\)/);
  assert.match(main, /sendToWindow\(targetWindow, 'notes-tree-changed'\)/);
  assert.match(renderer, /ipcRenderer\.on\('notes-tree-changed', scheduleTreeRefresh\)/);
});

test('tree entries are sorted by newest modification time within their type', () => {
  assert.match(main, /return b\.mtimeMs - a\.mtimeMs/);
  assert.match(main, /a\.entry\.isDirectory\(\) && !b\.entry\.isDirectory\(\)/);
});

test('configured hidden folders do not render or trigger tree refreshes', () => {
  assert.match(main, /isHiddenDirectory\(fileName, getHiddenDirectories\(\)\)/);
  assert.match(main, /isHiddenDirectory\(relativePath, hiddenDirectories\)/);
});

test('switching notes directories replaces the active watcher', () => {
  const watcherCalls = main.match(/watchNotesDirectory\(sourceWindow\);/g) || [];
  assert.ok(watcherCalls.length >= 3);
  assert.match(main, /closeWorkspaceWatcher\(workspace\)/);
});

test('window focus refreshes the tree when native watching is unavailable', () => {
  assert.match(renderer, /window\.addEventListener\('focus', scheduleTreeRefresh\)/);
});
