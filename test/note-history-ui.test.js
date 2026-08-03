const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('file menu and renderer expose note history preview and restore', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(main, /label: '查看历史版本…'/);
  assert.match(main, /sendToActiveWindow\('open-note-history'\)/);
  assert.match(main, /ipcMain\.handle\('get-note-history'/);
  assert.match(main, /ipcMain\.handle\('read-note-history-version'/);
  assert.match(main, /ipcMain\.handle\('restore-note-history-version'/);
  assert.match(renderer, /ipcRenderer\.on\('open-note-history', showNoteHistory\)/);
  assert.match(renderer, /expectedHash: noteHistoryState\.currentHash/);
  assert.match(renderer, /target\.editor\.value = result\.content/);
  assert.match(html, /id="noteHistoryVersions"[^>]*role="listbox"/);
  assert.match(html, /id="noteHistoryPreview"/);
  assert.match(html, /id="noteHistoryRestore"[^>]*disabled/);
  assert.match(html, /id="noteHistoryDiff"/);
  assert.match(html, /id="noteHistoryPin"/);
  assert.match(html, /id="noteHistoryReplaceSelection"/);
  assert.match(renderer, /compareLines\(historicalContent, currentContent\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('apply-note-history-selection'/);
  assert.match(main, /ipcMain\.handle\('apply-note-history-selection'/);
  assert.match(renderer, /ipcRenderer\.invoke\('update-note-history-version'/);
});

test('history storage is isolated by workspace under Electron user data', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /historyRoot: path\.join\(app\.getPath\('userData'\), 'history'\)/);
  assert.match(main, /workspacePath: workspace\.notesDir/);
});

test('history settings expose statistics, retention controls and safe cleanup', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(main, /ipcMain\.handle\('get-history-storage'/);
  assert.match(main, /ipcMain\.handle\('set-history-settings'/);
  assert.match(main, /ipcMain\.handle\('cleanup-note-history'/);
  assert.match(renderer, /ipcRenderer\.invoke\('get-history-storage'\)/);
  assert.match(html, /id="historyBucketMinutes"/);
  assert.match(html, /id="historyMaxVersions"/);
  assert.match(html, /id="historyMaxAgeDays"/);
  assert.match(html, /id="historyCleanup"/);
});
