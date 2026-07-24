const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const packageJson = require('../package.json');

test('编辑器包含紧凑的查找栏控件', () => {
  assert.match(html, /id="editorFindBar"[^>]*hidden/);
  assert.match(html, /id="editorFindInput"/);
  assert.match(html, /id="editorFindCount"/);
  assert.match(html, /id="editorFindPrevious"/);
  assert.match(html, /id="editorFindNext"/);
  assert.match(html, /id="editorFindClose"/);
});

test('查找栏在正文上方独占一行且参与布局', () => {
  assert.match(
    styles,
    /\.editor-find-bar\s*\{[^}]*position: relative;[^}]*width: auto;[^}]*flex: 0 0 38px;/s
  );
  assert.doesNotMatch(styles, /\.editor-find-bar\s*\{[^}]*position: absolute;/s);
  assert.match(styles, /\.editor-find-bar\[hidden\]\s*\{[^}]*display: none;/s);
});

test('查找栏挂载到当前编辑面板的正文上方', () => {
  assert.match(
    renderer,
    /const container = editorAdapter === editorRight \? editorContainerRight : editorContainer/
  );
  assert.match(renderer, /container\.before\(editorFindBar\)/);
});

test('查找栏铺满面板并将控件与正文文字区域对齐', () => {
  assert.match(
    styles,
    /\.editor-find-bar\s*\{[^}]*margin: 0;[^}]*padding-right: max\([^}]*padding-left: max\(/s
  );
  assert.match(styles, /\.editor-find-input\s*\{[^}]*flex: 1 1 auto;/s);
});

test('查找栏使用正文背景而非悬浮卡片样式', () => {
  assert.match(
    styles,
    /\.editor-find-bar\s*\{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: var\(--bg-primary\);[^}]*box-shadow: none;/s
  );
  assert.doesNotMatch(styles, /:root\[data-theme='light'\] \.editor-find-bar/);
});

test('查找导航按钮使用明确的向上和向下箭头', () => {
  const previousButton = html.match(
    /<button id="editorFindPrevious"[\s\S]*?<\/button>/
  )?.[0];
  const nextButton = html.match(
    /<button id="editorFindNext"[\s\S]*?<\/button>/
  )?.[0];

  assert.match(previousButton, /<path d="M12 19V5M6 11l6-6 6 6">/);
  assert.match(nextButton, /<path d="M12 5v14M6 13l6 6 6-6">/);
});

test('普通命中与当前命中使用不同高亮', () => {
  assert.match(styles, /\.cm-find-match\s*\{[^}]*background:/s);
  assert.match(styles, /\.cm-find-match-current\s*\{[^}]*background:/s);
});

test('Command 或 Ctrl+F 打开当前焦点编辑器的查找栏', () => {
  assert.match(
    renderer,
    /\(event\.metaKey \|\| event\.ctrlKey\)[\s\S]*event\.key\.toLowerCase\(\) === 'f'/
  );
  assert.match(renderer, /openEditorFind\(lastActiveEditor \|\| editor\)/);
});

test('查找命中使用独立 CodeMirror 标记并支持循环导航', () => {
  assert.match(renderer, /\? 'cm-find-match cm-find-match-current'/);
  assert.match(renderer, /: 'cm-find-match';/);
  assert.match(renderer, /getNextEditorMatchIndex\(/);
  assert.match(renderer, /codeMirror\.scrollIntoView\(/);
});

test('Enter 和 Shift+Enter 控制下一个与上一个命中', () => {
  assert.match(
    renderer,
    /editorFindInput\.addEventListener\('keydown',[\s\S]*event\.shiftKey \? -1 : 1/
  );
});

test('查找逻辑模块包含在应用打包文件中', () => {
  assert.ok(packageJson.build.files.includes('editor-find.js'));
});

test('关闭右栏时关闭其查找状态并恢复左栏为活动编辑器', () => {
  assert.match(
    renderer,
    /function closeRightPanel\(\) \{[\s\S]*editorFindState\.editor === editorRight[\s\S]*closeEditorFind\(\)[\s\S]*lastActiveEditor = editor;/
  );
});

test('活动模态框和阅读模式不抢占编辑器查找快捷键', () => {
  assert.match(
    renderer,
    /document\.querySelector\('\.modal\.active'\)[\s\S]*app\.classList\.contains\('reading-mode'\)/
  );
});

test('重置笔记库时清理隐藏右栏的查找状态', () => {
  assert.match(
    renderer,
    /function resetCurrentLibrary\(\) \{[\s\S]*editorFindState\.editor === editorRight[\s\S]*closeEditorFind\(\)[\s\S]*lastActiveEditor = editor;/
  );
});

test('查找框有命中时不关闭正文预渲染', () => {
  assert.doesNotMatch(renderer, /isEditorFindSourceVisible/);
});

test('进入阅读模式时关闭已打开的编辑器查找', () => {
  assert.match(
    renderer,
    /reading-mode-changed[\s\S]*if \(enabled\) \{[\s\S]*closeEditorFind\(\)/
  );
});

test('当前查找命中通过活动光标切换为源码行', () => {
  assert.match(
    renderer,
    /const current = editorFindState\.matches\[editorFindState\.currentIndex\];[\s\S]*codeMirror\.setCursor\(codeMirror\.posFromIndex\(current\.from\)\)/
  );
});

test('查找输入与按钮保留清晰的键盘焦点样式', () => {
  assert.match(styles, /\.editor-find-input:focus-visible\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /\.editor-find-button:focus-visible\s*\{[^}]*outline:/s);
});
