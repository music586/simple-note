const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('each application window owns its notes directory and file watcher', () => {
  assert.match(main, /const windowWorkspaces = new Map\(\)/);
  assert.match(main, /workspace\.notesDir = path\.resolve\(notesDir\)/);
  assert.match(main, /resolveLibraryPath\(getNotesDir\(source\), inputPath, options\)/);
  assert.match(main, /workspace\.watcher = fs\.watch/);
  assert.match(main, /setWindowNotesDir\(sourceWindow, selectedPath\)/);
  assert.match(main, /setWindowNotesDir\(sourceWindow, location\.path\)/);
});

test('window menu lists workspaces and brings the chosen window forward', () => {
  assert.match(main, /label: '窗口'/);
  assert.match(main, /\.\.\.getWindowMenuItems\(\)/);
  assert.match(main, /label: `\$\{index \+ 1\}\. \$\{workspaceName\}`/);
  assert.match(main, /if \(window\.isMinimized\(\)\) window\.restore\(\)/);
  assert.match(main, /window\.show\(\);\s*window\.focus\(\)/);
});

test('open windows and their workspaces are restored on the next launch', () => {
  assert.match(main, /config\.openWindows = BrowserWindow\.getAllWindows\(\)/);
  assert.match(main, /notesDir: getNotesDir\(window\)/);
  assert.match(main, /bounds: window\.getNormalBounds\(\)/);
  assert.match(main, /const windowSessions = getPersistedWindowSessions\(\)/);
  assert.match(main, /windowSessions\.forEach\(session => createWindow\(session\)\)/);
  assert.match(main, /if \(session\.notesDir\) workspace\.notesDir = path\.resolve/);
  assert.match(main, /if \(session\.maximized\) newWindow\.maximize\(\)/);
  assert.match(main, /isQuitting = true;[\s\S]*persistWindowSessions\(\)/);
});

test('workspace sessions are isolated by window and directory', () => {
  assert.match(renderer, /const workspaceIdentity = `\$\{notesInfo\.workspaceId\}:\$\{notesInfo\.path\}`/);
  assert.match(renderer, /crypto\.createHash\('sha256'\)/);
  assert.match(renderer, /workspaceSessionKey = `workspace-session:/);
  assert.match(renderer, /await loadTree\(\);\s*await restoreWorkspaceSession\(\)/);
});

test('context menu actions return to the source window', () => {
  const contextHandler = main.slice(
    main.indexOf("ipcMain.on('show-context-menu'"),
    main.indexOf("ipcMain.on('show-table-context-menu'")
  );
  assert.match(contextHandler, /BrowserWindow\.fromWebContents\(event\.sender\)/);
  assert.match(contextHandler, /event\.sender\.send\('context-menu-rename'/);
  assert.doesNotMatch(contextHandler, /mainWindow\.webContents\.send/);
  assert.match(contextHandler, /menu\.popup\(\{ window: sourceWindow \}\)/);
});
