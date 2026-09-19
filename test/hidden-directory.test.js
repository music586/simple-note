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

const os = require('node:os');
const {
  getLibraryHiddenDirectories,
  saveLibraryHiddenDirectories
} = require('../hidden-directory');

function makeLibrary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-hidden-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('library rules migrate once, remain isolated, and preserve empty lists', t => {
  const first = makeLibrary(t);
  const second = makeLibrary(t);
  assert.deepEqual(getLibraryHiddenDirectories(first, { hiddenDirectories: ['旧目录'] }), ['旧目录']);
  assert.deepEqual(getLibraryHiddenDirectories(second), defaultHiddenDirectories);
  saveLibraryHiddenDirectories(first, []);
  assert.deepEqual(getLibraryHiddenDirectories(first, { hiddenDirectories: ['旧目录'] }), []);
  assert.deepEqual(getLibraryHiddenDirectories(second), defaultHiddenDirectories);
  assert.equal(isHiddenDirectory('.simple-note/settings.json', []), true);
});

test('library configuration travels with the library and preserves unrelated fields', t => {
  const first = makeLibrary(t);
  const second = makeLibrary(t);
  saveLibraryHiddenDirectories(first, ['项目/归档']);
  const file = path.join(first, '.simple-note', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hiddenDirectories: ['项目/归档'], custom: { enabled: true } }));
  saveLibraryHiddenDirectories(first, ['草稿']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).custom, { enabled: true });
  fs.cpSync(path.join(first, '.simple-note'), path.join(second, '.simple-note'), { recursive: true });
  assert.deepEqual(getLibraryHiddenDirectories(second), ['草稿']);
});

test('invalid configuration and symbolic links are never overwritten', t => {
  const library = makeLibrary(t);
  saveLibraryHiddenDirectories(library, []);
  const file = path.join(library, '.simple-note', 'settings.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => getLibraryHiddenDirectories(library));
  assert.throws(() => saveLibraryHiddenDirectories(library, ['草稿']));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(library, 'missing.json'), file);
  assert.throws(() => saveLibraryHiddenDirectories(library, []), /符号链接/);
});

test('external configuration edits are read without restarting', t => {
  const library = makeLibrary(t);
  getLibraryHiddenDirectories(library);
  const file = path.join(library, '.simple-note', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hiddenDirectories: ['外部修改'] }));
  assert.deepEqual(getLibraryHiddenDirectories(library), ['外部修改']);
});
