const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'codemirror6-adapter.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const diagnostic = fs.readFileSync(
  path.join(root, 'scripts', 'editor-history-diagnostic.js'),
  'utf8'
);

test('each editor keeps bounded per-note CodeMirror history without recording note loads', () => {
  assert.match(adapter, /this\.documentStates = new Map\(\)/);
  assert.match(adapter, /state\.toJSON\(\{ history: historyField \}\)/);
  assert.match(adapter, /EditorState\.fromJSON\([\s\S]*\{ history: historyField \}/);
  assert.match(adapter, /while \(this\.documentStates\.size > 20\)/);
  assert.match(renderer, /editor\.loadDocument\(note\.path, content\)/);
  assert.match(renderer, /editorRight\.loadDocument\(note\.path, content\)/);
  assert.doesNotMatch(renderer, /editor\.value = content/);
});

test('undo and redo expose semantic state through the active window menu', () => {
  assert.match(adapter, /undoDepth\(this\.view\.state\)/);
  assert.match(adapter, /redoDepth\(this\.view\.state\)/);
  assert.match(main, /id: 'editor-undo'[\s\S]*sendToActiveWindow\('editor-undo'\)/);
  assert.match(main, /id: 'editor-redo'[\s\S]*sendToActiveWindow\('editor-redo'\)/);
  assert.match(main, /`撤销“\$\{state\.undoLabel\}”`/);
  assert.match(main, /`重做“\$\{state\.redoLabel\}”`/);
  assert.match(renderer, /ipcRenderer\.on\('request-editor-history-state'/);
});

test('semantic replacements are isolated into single named history transactions', () => {
  assert.match(adapter, /annotations: isolateHistory\.of\('before'\)/);
  for (const label of [
    'AI 排版',
    'AI 翻译',
    '粘贴',
    '插入表格',
    '插入代码块',
    '插入模板',
    '应用历史内容',
    '恢复历史版本'
  ]) {
    assert.match(renderer, new RegExp(label));
  }
});

test('standard redo shortcuts no longer conflict with writing mode', () => {
  assert.match(adapter, /\{ key: 'Shift-Meta-z', run: redo \}/);
  assert.match(adapter, /\{ key: 'Ctrl-y', run: redo \}/);
  assert.match(main, /id: 'editor-redo'[\s\S]*accelerator: 'CmdOrCtrl\+Shift\+Z'/);
  assert.match(main, /id: 'zen-mode'[\s\S]*accelerator: 'CmdOrCtrl\+Alt\+Z'/);
});

test('Electron diagnostic covers undo redo and per-note history restoration', () => {
  assert.match(diagnostic, /editor\.runHistoryCommand\('undo'\)/);
  assert.match(diagnostic, /editor\.runHistoryCommand\('redo'\)/);
  assert.match(diagnostic, /editor\.loadDocument\('\/notes\/b\.md'/);
  assert.match(diagnostic, /restoredUndo/);
});
