const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('selected editor text exposes an AI layout context menu action', () => {
  assert.match(renderer, /function bindEditorSelectionContextMenu\(editorAdapter\)/);
  assert.match(renderer, /codeMirror\.somethingSelected\(\)/);
  assert.match(renderer, /ipcRenderer\.send\('show-editor-selection-context-menu'\)/);
  assert.match(renderer, /bindEditorSelectionContextMenu\(editor\)/);
  assert.match(renderer, /bindEditorSelectionContextMenu\(editorRight\)/);
  assert.match(main, /ipcMain\.on\('show-editor-selection-context-menu'/);
  assert.match(main, /label: 'AI 排版'/);
  assert.match(main, /event\.sender\.send\('ai-optimize-layout-selection'\)/);
});

test('selected editor text exposes Chinese and English AI translation actions', () => {
  assert.match(
    main,
    /show-editor-selection-context-menu'[\s\S]*label: 'AI 翻译'[\s\S]*label: '中文'/
  );
  assert.match(
    main,
    /show-editor-selection-context-menu'[\s\S]*label: 'AI 翻译'[\s\S]*label: '英文'/
  );
  assert.match(main, /event\.sender\.send\('ai-translate', 'zh'\)/);
  assert.match(main, /event\.sender\.send\('ai-translate', 'en'\)/);
});

test('context AI layout replaces only the unchanged selected range', () => {
  assert.match(
    renderer,
    /ipcRenderer\.on\('ai-optimize-layout-selection'[\s\S]*selectionOnly: true/
  );
  assert.match(
    renderer,
    /targetEditor\.value\.slice\(selectionStart, selectionEnd\)/
  );
  assert.match(
    renderer,
    /targetEditor\.setRangeText\([\s\S]*optimizedContent,[\s\S]*'AI 排版'/
  );
  assert.match(renderer, /等待 AI 响应期间选中内容已改变/);
});
