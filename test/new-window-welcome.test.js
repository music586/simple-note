const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('first launch and manually created windows request the welcome guide', () => {
  assert.match(main, /click: \(\) => createWindow\(\{ showWelcome: true \}\)/);
  assert.match(main, /query: \{ welcome: isFirstLaunch \? 'first' : '1' \}/);
  assert.match(main, /windowSessions\.forEach\(session => createWindow\(session\)\)/);
});

test('welcome guide offers directory choice, current workspace and close actions', () => {
  assert.match(html, /id="newWindowWelcome"[^>]*hidden/);
  assert.match(html, /id="welcomeChooseDirectory"/);
  assert.match(html, /id="welcomeUseCurrent"/);
  assert.match(html, /id="welcomeCloseWindow"/);
  assert.match(html, /id="welcomeStoragePath"/);
  assert.match(html, /id="welcomeLocations"/);
  assert.match(renderer, /URLSearchParams\(window\.location\.search\).*'welcome'/);
  assert.match(renderer, /if \(await changeNotesDir\(\{ keepWelcome: true \}\)\) \{/);
  assert.match(renderer, /ipcRenderer\.invoke\('close-current-window'\)/);
  assert.match(main, /ipcMain\.handle\('close-current-window'/);
  assert.match(styles, /\.new-window-welcome\s*\{/);
  assert.match(styles, /\.new-window-welcome\[hidden\][\s\S]*display: none/);
});
