const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('workspace session records both notes, focus, and the release notes page', () => {
  assert.match(renderer, /const workspaceSessionKey = 'workspace-session'/);
  assert.match(renderer, /leftNotePath: currentNote\?\.path \|\| null/);
  assert.match(renderer, /rightNotePath: currentNoteRight\?\.path \|\| null/);
  assert.match(renderer, /activePane: lastActiveEditor === editorRight \? 'right' : 'left'/);
  assert.match(renderer, /releasePane,/);
  assert.match(renderer, /window\.addEventListener\('beforeunload', saveWorkspaceSession\)/);
});

test('refresh restores only notes that still exist in the current tree', () => {
  assert.match(renderer, /function getTreeNoteByPath\(items, notePath\)/);
  assert.match(renderer, /const leftNote = getTreeNoteByPath\(tree, session\.leftNotePath\)/);
  assert.match(renderer, /const rightNote = getTreeNoteByPath\(tree, session\.rightNotePath\)/);
  assert.match(renderer, /if \(leftNote\) await selectNote\(leftNote\)/);
  assert.match(renderer, /await openInRightPanel\(rightNote\)/);
  assert.match(renderer, /loadTree\(\)\.then\(restoreWorkspaceSession\)/);
});

test('release notes restore with the current application version', () => {
  assert.match(main, /ipcMain\.handle\('get-app-version', \(\) => app\.getVersion\(\)\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('get-app-version'\)/);
  assert.match(renderer, /showReleaseNotes\(null, appVersion\)/);
});

test('expanded directory state survives refresh and ignores missing folders', () => {
  assert.match(renderer, /expandedFolderPaths: \[\.\.\.expandedFolders\]/);
  assert.match(renderer, /function getTreeFolderPaths\(items, paths = new Set\(\)\)/);
  assert.match(renderer, /const validFolderPaths = getTreeFolderPaths\(tree\)/);
  assert.match(
    renderer,
    /savedFolderPaths\.filter\(folderPath => validFolderPaths\.has\(folderPath\)\)/
  );
  assert.match(
    renderer,
    /folderEl\.addEventListener\('click'[\s\S]*renderTree\(\);\s*saveWorkspaceSession\(\)/
  );
});
