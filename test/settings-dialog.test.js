const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('settings dialog shows a read-only image directory chooser', () => {
  for (const id of [
    'settingsModal', 'settingsClose', 'imageDirectoryPath', 'imageDirectoryMode',
    'imageDirectoryChoose', 'imageDirectoryReset', 'settingsDone', 'settingsError'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="imageDirectoryPath"[^>]*<input/);
});

test('settings dialog is driven by image directory IPC', () => {
  assert.match(renderer, /ipcRenderer\.on\('open-settings'/);
  assert.match(renderer, /ipcRenderer\.invoke\('get-image-directory'\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('select-image-directory'\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('reset-image-directory'\)/);
});

test('settings dialog uses the centered modal system', () => {
  assert.match(styles, /\.settings-modal-content\s*\{/);
  assert.match(styles, /\.image-directory-path\s*\{/);
});

test('settings dialog handles rejected IPC with visible Chinese errors', () => {
  assert.match(renderer, /function getSettingsErrorMessage\(/);
  assert.match(renderer, /设置加载失败/);
  assert.match(renderer, /选择图片目录失败/);
  assert.match(renderer, /恢复默认目录失败/);
  assert.match(renderer, /try\s*\{[\s\S]*ipcRenderer\.invoke\('get-image-directory'\)/);
});

test('settings dialog owns keyboard focus while open', () => {
  assert.match(renderer, /settingsPreviousFocus = document\.activeElement/);
  assert.match(renderer, /settingsDone\.focus\(\)/);
  assert.match(renderer, /settingsModal\.querySelectorAll\(/);
  assert.match(renderer, /event\.stopImmediatePropagation\(\)/);
  assert.match(renderer, /document\.addEventListener\('keydown',[\s\S]*true\);/);
});

test('settings dialog prevents stale and duplicate directory requests', () => {
  assert.match(renderer, /settingsRequestId/);
  assert.match(renderer, /requestId !== settingsRequestId/);
  assert.match(renderer, /setSettingsBusy\(true\)/);
  assert.match(renderer, /if \(settingsBusy\) return/);
});

test('settings dialog clears stale directory state before loading', () => {
  assert.match(renderer, /function resetImageDirectorySettings\(\)/);
  assert.match(renderer, /imageDirectoryPath\.textContent = ''/);
  assert.match(renderer, /imageDirectoryMode\.textContent = '正在加载…'/);
  assert.match(renderer, /settingsIsCustom = false/);
  assert.match(renderer, /resetImageDirectorySettings\(\);[\s\S]*get-image-directory/);
});

test('failed custom directory loads enable recovery actions', () => {
  assert.match(renderer, /function renderFailedImageDirectorySettings\(result\)/);
  assert.match(renderer, /renderImageDirectorySettings\(result\)/);
  assert.match(renderer, /if \(result\.isCustom && result\.effectivePath\)/);
});

test('picker cancellation keeps an invalid directory error visible', () => {
  assert.match(renderer, /if \(result\.canceled && result\.error\)/);
  assert.match(renderer, /getSettingsErrorMessage\('当前目录不可用', result\.error\)/);
});
