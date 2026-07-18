const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('macOS application menu opens settings', () => {
  const appMenu = source.slice(source.indexOf('label: appName'), source.indexOf("label: '文件'"));
  assert.match(appMenu, /label: '设置…'/);
  assert.match(appMenu, /sendToActiveWindow\('open-settings'\)/);
});

test('main process exposes image directory settings IPC', () => {
  assert.match(source, /ipcMain\.handle\('get-image-directory'/);
  assert.match(source, /ipcMain\.handle\('select-image-directory'/);
  assert.match(source, /ipcMain\.handle\('reset-image-directory'/);
  assert.match(source, /properties: \['openDirectory', 'createDirectory'\]/);
});

test('clipboard images use the configured image directory', () => {
  assert.match(source, /getImageDirectoryState\(config, notesDir\)/);
  assert.doesNotMatch(source, /const assetsDir = path\.join\(notesDir, 'assets'\)/);
});
