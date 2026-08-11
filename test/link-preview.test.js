const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const { normalizePreviewMarkdown } = require('../preview-markdown');

test('editor pre-renders web, application and relative links with distinct indicators', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(styles, /\.cm-rendered-link\.is-external::after\s*\{[^}]*content: '↗'/s);
  assert.match(styles, /\.cm-rendered-link\.is-application::after\s*\{[^}]*content: '◇'/s);
  assert.match(styles, /\.cm-rendered-link\.is-relative::after\s*\{[^}]*content: '›'/s);
  assert.match(renderer, /function createEditorLinkWidget\(label, href\)/);
  assert.match(renderer, /const link = createEditorLinkWidget\('', match\[2\]\)/);
  assert.match(renderer, /replaceInlineRange\(match\.index, match\.index \+ match\[0\]\.length, link\)/);
});

test('editor pre-renders HTML links and focuses them back to source', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const diagnostic = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'editor-prerender-diagnostic.js'),
    'utf8'
  );

  assert.match(renderer, /function getHtmlPreviewRanges\(lineText\)/);
  assert.match(renderer, /createInlineHtmlWidget\(range\.source, note\)/);
  assert.match(renderer, /replaceHtmlPreviewRange\(/);
  assert.ok(diagnostic.includes('<a href="./other.md">HTML 相对链接</a>'));
  assert.match(diagnostic, /result\.htmlLinkFocusRestoresSource/);
  assert.match(diagnostic, /result\.links === 5/);
});

test('completed Markdown links pre-render immediately on the active line', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const diagnostic = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'editor-prerender-diagnostic.js'),
    'utf8'
  );

  assert.match(renderer, /const activeLinkPattern = \/\\\[\(\[\^\\\]\]\+\)\\\]\\\(\(\[\^\)\]\+\)\\\)\/g/);
  assert.match(renderer, /let activeLinkMatch;/);
  assert.match(renderer, /activeCursor\.ch > fromCh && activeCursor\.ch < toCh/);
  assert.ok(diagnostic.includes('[活动相对链接](./other.md)'));
  assert.match(diagnostic, /result\.links === 5/);
});

test('right preview normalizes an accidental space after an HTTP protocol', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(renderer, /marked\.parse\(normalizePreviewMarkdown\(content\)\)/g);
  assert.match(
    marked.parse(normalizePreviewMarkdown('[百度](https:// baidu.com)')),
    /<a href="https:\/\/baidu\.com">百度<\/a>/
  );
});

test('preview link normalization does not alter fenced code or note source', () => {
  const source = '```md\n[百度](https:// baidu.com)\n```\n[百度](https:// baidu.com)';
  const normalized = normalizePreviewMarkdown(source);

  assert.equal(source.includes('https:// baidu.com'), true);
  assert.equal(normalized, '```md\n[百度](https:// baidu.com)\n```\n[百度](https://baidu.com)');
});

test('preview links route external and relative targets without navigating the app', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(renderer, /event\.preventDefault\(\)/);
  assert.match(renderer, /function openRenderedMarkdownLink\(href, note\)/);
  assert.match(renderer, /link\.getAttribute\('href'\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('open-relative-link'/);
  assert.match(renderer, /ipcRenderer\.invoke\('open-application-url'/);
  assert.match(main, /ipcMain\.handle\('open-external-url'/);
  assert.match(main, /ipcMain\.handle\('open-application-url'/);
  assert.match(main, /ipcMain\.handle\('open-relative-link'/);
  assert.match(main, /相对链接不能指向笔记库外部/);
  assert.match(main, /url\.protocol !== 'http:' && url\.protocol !== 'https:'/);
  assert.match(main, /shell\.openExternal\(url\.href\)/);
  assert.match(
    main,
    /\['http:', 'https:', 'file:', 'javascript:', 'data:'\]\.includes\(url\.protocol\)/
  );
});
