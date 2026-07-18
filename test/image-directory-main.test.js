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

test('image directory settings IPC returns errors instead of throwing', () => {
  const handler = source.slice(
    source.indexOf("ipcMain.handle('get-image-directory'"),
    source.indexOf("ipcMain.handle('select-image-directory'")
  );
  assert.match(handler, /try \{/);
  assert.match(handler, /catch \(err\)/);
  assert.match(handler, /return \{ success: false, error: err\.message \}/);
});

test('clipboard images use the configured image directory', () => {
  assert.match(source, /getImageDirectoryState\(config, notesDir\)/);
  assert.doesNotMatch(source, /const assetsDir = path\.join\(notesDir, 'assets'\)/);
});

test('custom image directories must be writable directories', () => {
  assert.match(source, /fs\.statSync\(directoryPath\)/);
  assert.match(
    source,
    /fs\.accessSync\(directoryPath, fs\.constants\.W_OK \| fs\.constants\.X_OK\)/
  );
  assert.match(source, /validateCustomImageDirectory\(selectedPath\)/);
  assert.match(source, /validateCustomImageDirectory\(assetsDir\)/);
  assert.match(source, /自定义图片路径不是文件夹/);
  assert.match(source, /自定义图片目录不可进入或写入/);
});
