const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const { normalizePreviewMarkdown } = require('../preview-markdown');

test('editor pre-renders external and relative links with distinct indicators', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(styles, /\.cm-rendered-link\.is-external::after\s*\{[^}]*content: '↗'/s);
  assert.match(styles, /\.cm-rendered-link\.is-relative::after\s*\{[^}]*content: '›'/s);
  assert.match(renderer, /function createEditorLinkWidget\(label, href\)/);
  assert.match(renderer, /replacedWith: createEditorLinkWidget\(match\[1\], match\[2\]\)/);
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
  assert.match(main, /ipcMain\.handle\('open-external-url'/);
  assert.match(main, /ipcMain\.handle\('open-relative-link'/);
  assert.match(main, /相对链接不能指向笔记库外部/);
  assert.match(main, /url\.protocol !== 'http:' && url\.protocol !== 'https:'/);
  assert.match(main, /shell\.openExternal\(url\.href\)/);
});
