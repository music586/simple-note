const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'codemirror6-adapter.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('应用只安装 CodeMirror 6 模块', () => {
  assert.equal(packageJson.dependencies.codemirror, undefined);
  for (const dependency of [
    '@codemirror/commands',
    '@codemirror/lang-markdown',
    '@codemirror/language',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view'
  ]) {
    assert.match(packageJson.dependencies[dependency], /^\^6\./);
  }
});

test('渲染进程使用 CM6 状态、视图和声明式装饰', () => {
  assert.match(renderer, /require\('\.\/codemirror6-adapter'\)/);
  assert.doesNotMatch(renderer, /require\('codemirror'\)/);
  assert.match(adapter, /EditorState/);
  assert.match(adapter, /EditorView/);
  assert.match(adapter, /StateField\.define/);
  assert.match(adapter, /Decoration\.(?:mark|replace|widget|line)/);
  assert.match(adapter, /EditorView\.updateListener/);
});

test('页面和样式不再依赖 CM5 资源或 DOM 类名', () => {
  assert.doesNotMatch(html, /codemirror\/lib\/codemirror\.css/);
  assert.doesNotMatch(styles, /\.CodeMirror(?:\b|-)/);
  assert.match(styles, /\.editor-pane > \.cm-editor/);
  assert.match(styles, /\.cm-content/);
  assert.match(styles, /\.cm-scroller/);
});

test('CM6 skips empty mark ranges without aborting viewport pre-render', () => {
  assert.match(adapter, /if \(start === end && !options\.replacedWith\)/);
  assert.match(adapter, /start === end && options\.replacedWith/);
});

test('CM6 batches decoration replacement into one state transaction', () => {
  assert.match(adapter, /const updateDecorationsEffect = StateEffect\.define\(\)/);
  assert.match(adapter, /pendingDecorationUpdate = \{ clearIds: new Set\(\), additions: \[\] \}/);
  assert.match(adapter, /this\.view\.dispatch\(\{ effects: updateDecorationsEffect\.of\(update\) \}\)/);
  assert.match(adapter, /this\.pendingDecorationUpdate\.additions\.push\(range\)/);
  assert.match(adapter, /this\.pendingDecorationUpdate\.clearIds\.add\(id\)/);
});
