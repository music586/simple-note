const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf-8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf-8');

test('active notes directory changes refresh the tree in every window', () => {
  assert.match(main, /fs\.watch\(getNotesDir\(\), \{ recursive: true \}/);
  assert.match(main, /webContents\.send\('notes-tree-changed'\)/);
  assert.match(renderer, /ipcRenderer\.on\('notes-tree-changed', scheduleTreeRefresh\)/);
});

test('tree entries are sorted by newest modification time within their type', () => {
  assert.match(main, /return b\.mtimeMs - a\.mtimeMs/);
  assert.match(main, /a\.entry\.isDirectory\(\) && !b\.entry\.isDirectory\(\)/);
});

test('git metadata folders are hidden and do not trigger tree refreshes', () => {
  assert.match(main, /item\.name === '\.git'/);
  assert.match(main, /pathParts\.includes\('\.git'\)/);
});

test('switching notes directories replaces the active watcher', () => {
  const watcherCalls = main.match(/watchNotesDirectory\(\);/g) || [];
  assert.ok(watcherCalls.length >= 4);
  assert.match(main, /notesDirectoryWatcher\.close\(\)/);
});

test('window focus refreshes the tree when native watching is unavailable', () => {
  assert.match(renderer, /window\.addEventListener\('focus', scheduleTreeRefresh\)/);
});
