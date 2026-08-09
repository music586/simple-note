const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeClipboardText,
  joinClipboardTextAndImages,
  joinClipboardStructuredContent,
  normalizeClipboardMarkdown,
  removeGeneratedBoundaryNewlines,
  shouldConvertClipboardHtml,
  isMarkdownDocumentText,
  applyClipboardMarkdownMarks,
  optimizeClipboardPlainText
} = require('../clipboard-format');

test('rich clipboard Markdown removes placeholder lines and excessive blank lines', () => {
  assert.equal(
    normalizeClipboardMarkdown('第一段\n\n\u00a0 \n\n\u200b\n\n第二段'),
    '第一段\n\n第二段'
  );
});

test('rich clipboard Markdown preserves whitespace and blank lines inside fenced code', () => {
  assert.equal(
    normalizeClipboardMarkdown('正文\n\n\n```text\n第一行\n\n\n第二行\n```\n\n\n结尾'),
    '正文\n\n```text\n第一行\n\n\n第二行\n```\n\n结尾'
  );
});

test('structured clipboard content adds only missing document separators', () => {
  assert.equal(joinClipboardStructuredContent('前文', 2, 2, '粘贴内容'), '\n\n粘贴内容');
  assert.equal(
    joinClipboardStructuredContent('前文\n后文', 3, 3, '粘贴内容'),
    '\n粘贴内容\n\n'
  );
  assert.equal(
    joinClipboardStructuredContent('前文\n\n后文', 4, 4, '粘贴内容'),
    '粘贴内容\n\n'
  );
});

test('clipboard text preserves spaces and blank lines while normalizing line endings', () => {
  assert.equal(
    normalizeClipboardText('  第一行  \r\n\r\n\r\n    第二行\r'),
    '  第一行  \n\n\n    第二行\n'
  );
});

test('image layout adds only the missing separator without trimming clipboard text', () => {
  assert.equal(
    joinClipboardTextAndImages('  正文  ', '![图片](a.png)'),
    '  正文  \n\n![图片](a.png)'
  );
  assert.equal(
    joinClipboardTextAndImages('正文\n\n\n', '![图片](a.png)'),
    '正文\n\n\n![图片](a.png)'
  );
});

test('HTML conversion removes only its generated outer newlines', () => {
  assert.equal(removeGeneratedBoundaryNewlines('\n  正文  \n\n\n'), '  正文  \n\n');
});

test('formatted and multiline clipboard HTML is converted instead of flattened to text', () => {
  assert.equal(shouldConvertClipboardHtml('<p><strong>加粗</strong><br>换行</p>'), true);
  assert.equal(shouldConvertClipboardHtml('<span>普通文本</span>'), false);
  assert.equal(shouldConvertClipboardHtml(''), false);
});

test('Markdown documents are pasted as source text instead of fenced code', () => {
  const document = [
    '# macOS DMG 包体积优化方案',
    '',
    '日期：2026-08-01',
    '',
    '## 当前情况',
    '',
    '- 第一项'
  ].join('\n');

  assert.equal(isMarkdownDocumentText(document), true);
  assert.equal(isMarkdownDocumentText('普通的单行文本'), false);
  assert.equal(isMarkdownDocumentText('第一行\n第二行'), false);
});

test('renderer converts clipboard bold tags and line breaks to Markdown', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const packageJson = require('../package.json');

  assert.match(renderer, /if \(tag === 'br'\) return '\\n'/);
  assert.match(renderer, /tag === 'strong' \|\| tag === 'b'/);
  assert.match(renderer, /clipboardHtmlToMarkdown\(htmlSource, \[\]\)/);
  assert.match(renderer, /if \(isMarkdownDocumentText\(text\)\) \{\s+pastedContent = text/);
  assert.match(renderer, /optimizeClipboardPlainText\(text\)/);
  assert.match(renderer, /editorCode \|\| htmlMarkdown \|\| textTable/);
  assert.ok(packageJson.build.files.includes('clipboard-format.js'));
});

test('rich clipboard HTML uses Turndown with GFM and a legacy fallback', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const packageJson = require('../package.json');

  assert.match(renderer, /const TurndownService = require\('turndown'\)/);
  assert.match(renderer, /const \{ gfm \} = require\('turndown-plugin-gfm'\)/);
  assert.match(renderer, /service\.use\(gfm\)/);
  assert.match(renderer, /headingStyle: 'atx'/);
  assert.match(renderer, /codeBlockStyle: 'fenced'/);
  assert.match(renderer, /service\.addRule\('local-images'/);
  assert.match(renderer, /function promoteClipboardInlineStyles\(documentNode\)/);
  assert.match(renderer, /return clipboardHtmlToMarkdownLegacy\(html, relativePaths\)/);
  assert.equal(packageJson.dependencies.turndown, '^7.2.4');
  assert.equal(packageJson.dependencies['turndown-plugin-gfm'], '^1.0.2');
});

test('inline Markdown marks preserve the original clipboard whitespace layout', () => {
  const text = '  第一段  \n\n\n    加粗标题\n\n  第二段';
  const start = text.indexOf('加粗标题');

  assert.equal(applyClipboardMarkdownMarks(text, [{
    start,
    end: start + '加粗标题'.length,
    open: '**',
    close: '**'
  }]), '  第一段  \n\n\n    **加粗标题**\n\n  第二段');
});

test('article-like plain text gains paragraph spacing and inferred bold headings', () => {
  const text = [
    '　第一段正文。',
    '　　第二段正文。',
    '走进信息的洪流',
    '　　第三段正文。',
    '　　第四段正文。',
    '最昂贵的资源',
    '　　第五段正文。'
  ].join('\n');

  assert.equal(optimizeClipboardPlainText(text), [
    '　第一段正文。',
    '　　第二段正文。',
    '**走进信息的洪流**',
    '　　第三段正文。',
    '　　第四段正文。',
    '**最昂贵的资源**',
    '　　第五段正文。'
  ].join('\n\n'));
});

test('plain text optimization leaves short and already spaced content unchanged', () => {
  assert.equal(optimizeClipboardPlainText('第一行\n第二行'), '第一行\n第二行');
  assert.equal(
    optimizeClipboardPlainText('　正文一\n\n标题\n\n　正文二'),
    '　正文一\n\n标题\n\n　正文二'
  );
});

test('article optimization does not double-wrap headings already marked bold', () => {
  const text = [
    '　第一段正文。',
    '　　第二段正文。',
    '**走进信息的洪流**',
    '　　第三段正文。',
    '　　第四段正文。'
  ].join('\n');

  assert.equal(
    optimizeClipboardPlainText(text).split('\n\n')[2],
    '**走进信息的洪流**'
  );
});
