const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeClipboardText,
  joinClipboardTextAndImages,
  removeGeneratedBoundaryNewlines,
  shouldConvertClipboardHtml,
  applyClipboardMarkdownMarks,
  optimizeClipboardPlainText
} = require('../clipboard-format');

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

test('renderer converts clipboard bold tags and line breaks to Markdown', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const packageJson = require('../package.json');

  assert.match(renderer, /if \(tag === 'br'\) return '\\n'/);
  assert.match(renderer, /tag === 'strong' \|\| tag === 'b'/);
  assert.match(renderer, /clipboardHtmlToFormattedText\(htmlSource, text\)/);
  assert.match(renderer, /optimizeClipboardPlainText\(formattedText\)/);
  assert.match(renderer, /htmlBlock \|\| editorCode \|\| textTable/);
  assert.ok(packageJson.build.files.includes('clipboard-format.js'));
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
