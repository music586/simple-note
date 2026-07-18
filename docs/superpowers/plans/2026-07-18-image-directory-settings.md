# Image Directory Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centered settings dialog opened from the macOS “简记” menu that lets users choose or reset one global image directory used by future pasted images.

**Architecture:** Put path selection rules in a small CommonJS module so default/custom resolution can be tested without Electron. The main process owns configuration, native folder selection, and image saving; the renderer owns a read-only centered dialog driven by IPC.

**Tech Stack:** Electron 28, CommonJS JavaScript, Node.js `fs`/`path`, HTML/CSS, Node test runner.

## Global Constraints

- Keep the installed application name and Chinese UI text as “简记”.
- Do not add dependencies or change the `1.0.2` version.
- The custom directory is global for all notes and can only be chosen through the native directory picker.
- The default directory remains `<active notes library>/assets`.
- Existing images and Markdown are never moved or rewritten.
- Canceling directory selection leaves configuration unchanged.
- A missing or inaccessible saved custom directory produces a visible error instead of silently falling back.

---

### Task 1: Pure image-directory resolution

**Files:**
- Create: `image-directory.js`
- Create: `test/image-directory.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `getDefaultImageDirectory(notesDir: string): string`
- Produces: `getConfiguredImageDirectory(config: object): string | null`
- Produces: `getImageDirectoryState(config: object, notesDir: string): { defaultPath, customPath, effectivePath, isCustom }`

- [ ] **Step 1: Write failing pure-function tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  getDefaultImageDirectory,
  getConfiguredImageDirectory,
  getImageDirectoryState
} = require('../image-directory');

test('default image directory is the active library assets folder', () => {
  assert.equal(getDefaultImageDirectory('/notes'), path.join('/notes', 'assets'));
});

test('a global absolute custom directory overrides the default', () => {
  assert.deepEqual(getImageDirectoryState(
    { imageDirectory: '/Pictures/SimpleNote' },
    '/notes'
  ), {
    defaultPath: path.join('/notes', 'assets'),
    customPath: path.resolve('/Pictures/SimpleNote'),
    effectivePath: path.resolve('/Pictures/SimpleNote'),
    isCustom: true
  });
  assert.equal(getConfiguredImageDirectory({ imageDirectory: 'relative/path' }), null);
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test test/image-directory.test.js`

Expected: FAIL because `../image-directory` does not exist.

- [ ] **Step 3: Implement the path module**

```js
const path = require('path');

function getDefaultImageDirectory(notesDir) {
  return path.join(path.resolve(notesDir), 'assets');
}

function getConfiguredImageDirectory(config) {
  const value = config && typeof config.imageDirectory === 'string'
    ? config.imageDirectory.trim()
    : '';
  return value && path.isAbsolute(value) ? path.resolve(value) : null;
}

function getImageDirectoryState(config, notesDir) {
  const defaultPath = getDefaultImageDirectory(notesDir);
  const customPath = getConfiguredImageDirectory(config);
  return {
    defaultPath,
    customPath,
    effectivePath: customPath || defaultPath,
    isCustom: Boolean(customPath)
  };
}

module.exports = {
  getConfiguredImageDirectory,
  getDefaultImageDirectory,
  getImageDirectoryState
};
```

- [ ] **Step 4: Add `image-directory.js` to `build.files`, run tests, and commit**

Run: `node --test test/image-directory.test.js test/version.test.js`

Expected: PASS.

```bash
git add image-directory.js test/image-directory.test.js package.json
git commit -m "feat: resolve global image directory"
```

---

### Task 2: Main-process menu, IPC, and image saving

**Files:**
- Modify: `main.js`
- Create: `test/image-directory-main.test.js`

**Interfaces:**
- Consumes: `getImageDirectoryState(config, notesDir)` from Task 1.
- Produces IPC `get-image-directory` returning `{ success, defaultPath, customPath, effectivePath, isCustom, exists }`.
- Produces IPC `select-image-directory` returning `{ success, canceled, ...state }`.
- Produces IPC `reset-image-directory` returning `{ success, ...state }`.
- Produces renderer event `open-settings` from the “设置…” application-menu item.

- [ ] **Step 1: Write failing source-level integration tests**

```js
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
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test test/image-directory-main.test.js`

Expected: FAIL because menu and IPC handlers are absent.

- [ ] **Step 3: Add menu and IPC handlers**

Import `getImageDirectoryState`. Add “设置…” below “关于简记” and its separator. Implement a shared `getCurrentImageDirectoryState()` that reads `getConfig()` and `getNotesDir()`. The select handler must call:

```js
const result = await dialog.showOpenDialog(sourceWindow, {
  title: '选择图片文件目录',
  properties: ['openDirectory', 'createDirectory'],
  defaultPath: state.effectivePath
});
```

On selection, persist `config.imageDirectory = path.resolve(result.filePaths[0])`. On reset, `delete config.imageDirectory`. Return `exists: fs.existsSync(state.effectivePath)` from all state responses.

- [ ] **Step 4: Route clipboard image saving through the shared state**

Replace the hard-coded `notesDir/assets` assignment with:

```js
const config = getConfig();
const imageDirectory = getImageDirectoryState(config, notesDir);
const assetsDir = imageDirectory.effectivePath;
if (imageDirectory.isCustom && !fs.existsSync(assetsDir)) {
  throw new Error('自定义图片目录不存在或已被移动');
}
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
```

Keep `path.relative(path.dirname(resolvedNotePath), imagePath)` unchanged so Markdown remains portable.

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/image-directory-main.test.js test/image-directory.test.js test/preview-task.test.js`

Expected: PASS.

```bash
git add main.js test/image-directory-main.test.js
git commit -m "feat: configure image save directory"
```

---

### Task 3: Centered settings dialog

**Files:**
- Modify: `index.html`
- Modify: `renderer.js`
- Modify: `styles.css`
- Create: `test/settings-dialog.test.js`

**Interfaces:**
- Consumes IPC and `open-settings` event from Task 2.
- Produces DOM ids: `settingsModal`, `settingsClose`, `imageDirectoryPath`, `imageDirectoryMode`, `imageDirectoryChoose`, `imageDirectoryReset`, `settingsDone`, `settingsError`.

- [ ] **Step 1: Write failing dialog structure and behavior tests**

```js
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
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test test/settings-dialog.test.js`

Expected: FAIL because settings dialog ids are absent.

- [ ] **Step 3: Add accessible dialog markup**

Add a `.modal` sibling after `locationsModal`. Use existing `.modal-content`, `.modal-header`, `.modal-footer`, `.btn`, and `.btn-secondary` classes. Render the path in a `<div id="imageDirectoryPath" class="image-directory-path">`, not an input. Add `role="status"` to `settingsError` and Chinese labels exactly as specified.

- [ ] **Step 4: Add renderer behavior**

Implement `renderImageDirectorySettings(data)`, `showSettingsDialog()`, and `hideSettingsDialog()`. `showSettingsDialog()` invokes `get-image-directory`, clears prior errors, renders mode as “自定义目录” or “默认目录”, then adds `.active`. Selection and reset buttons refresh with the returned state. On `{ success: false }`, place `result.error` in `settingsError` and keep the dialog open. Disable reset when `isCustom` is false. Close on close button, done button, backdrop click, and Escape.

- [ ] **Step 5: Add restrained dialog styling**

Use a `520px` maximum width, existing theme variables, a single bordered directory row, monospace path text, and no new palette. Keep the current modal motion and focus-visible styles. At narrow widths use `calc(100vw - 32px)` and allow the path to wrap with `overflow-wrap: anywhere`.

- [ ] **Step 6: Run tests and commit**

Run: `node --test test/settings-dialog.test.js test/image-directory-main.test.js`

Expected: PASS.

```bash
git add index.html renderer.js styles.css test/settings-dialog.test.js
git commit -m "feat: add image directory settings dialog"
```

---

### Task 4: Full regression and packaging verification

**Files:**
- Modify only if a verification failure identifies a scoped defect.

**Interfaces:**
- Consumes all previous task outputs.
- Produces a verified application state with no test, syntax, or packaging-list regressions.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run syntax and whitespace checks**

Run:

```bash
node --check main.js
node --check renderer.js
node --check image-directory.js
git diff --check
```

Expected: every command exits `0` with no syntax or whitespace errors.

- [ ] **Step 3: Verify final requirements in source**

Run:

```bash
rg -n "设置…|open-settings|get-image-directory|select-image-directory|reset-image-directory|imageDirectory" main.js renderer.js index.html package.json
```

Expected: menu, IPC, renderer dialog, DOM, and packaged module are all present; no editable image-directory input exists.
