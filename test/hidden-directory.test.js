const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  defaultHiddenDirectories,
  normalizeHiddenDirectory,
  getHiddenDirectories,
  isHiddenDirectory
} = require('../hidden-directory');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('hidden directory settings preserve the previous built-in defaults', () => {
  assert.deepEqual(defaultHiddenDirectories, ['assets', '.obsidian', '.git']);
  assert.deepEqual(getHiddenDirectories({}), defaultHiddenDirectories);
  assert.deepEqual(getHiddenDirectories({ hiddenDirectories: [] }), []);
});

test('hidden directory paths are normalized and kept inside the notes library', () => {
  assert.equal(normalizeHiddenDirectory('./项目\\归档'), '项目/归档');
  assert.throws(() => normalizeHiddenDirectory('../外部目录'), /当前笔记库内/);
  assert.throws(() => normalizeHiddenDirectory('/绝对路径'), /隐藏目录无效/);
});

test('name rules hide matching nested folders and path rules hide one subtree', () => {
  assert.equal(isHiddenDirectory('项目/.git/config', ['.git']), true);
  assert.equal(isHiddenDirectory('项目/归档/旧稿.md', ['项目/归档']), true);
  assert.equal(isHiddenDirectory('其他/归档/旧稿.md', ['项目/归档']), false);
});

test('main process manages hidden directories with validated current-library selection', () => {
  assert.match(main, /ipcMain\.handle\('get-hidden-directories'/);
  assert.match(main, /ipcMain\.handle\('select-hidden-directory'/);
  assert.match(main, /ipcMain\.handle\('update-hidden-directory'/);
  assert.match(main, /ipcMain\.handle\('remove-hidden-directory'/);
  assert.match(main, /defaultPath: notesDir/);
  assert.match(
    main,
    /ipcMain\.handle\('select-hidden-directory'[\s\S]*properties: \['openDirectory', 'showHiddenFiles'\]/
  );
  assert.match(main, /只能选择当前笔记库内的子目录/);
  assert.match(main, /isHiddenDirectory\(relativePath, hiddenDirectories\)/);
  assert.ok(packageJson.build.files.includes('hidden-directory.js'));
});
