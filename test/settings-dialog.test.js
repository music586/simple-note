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
