const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getMarkdownFormatEdit } = require('../markdown-format');

test('inline formats wrap the selection and preserve its selected range', () => {
  assert.deepEqual(getMarkdownFormatEdit('hello', 0, 5, 'bold'), {
    from: 0,
    to: 5,
    text: '**hello**',
    selectionStart: 2,
    selectionEnd: 7
  });
  assert.equal(getMarkdownFormatEdit('hello', 0, 5, 'highlight').text, '==hello==');
  assert.equal(getMarkdownFormatEdit('hello', 0, 5, 'strikethrough').text, '~~hello~~');
});

test('bold toggles off when the selected text is already bold', () => {
  assert.deepEqual(getMarkdownFormatEdit('**hello**', 2, 7, 'bold'), {
    from: 0,
    to: 9,
    text: 'hello',
    selectionStart: 0,
    selectionEnd: 5
  });
  assert.deepEqual(getMarkdownFormatEdit('**hello**', 0, 9, 'bold'), {
    from: 0,
    to: 9,
    text: 'hello',
    selectionStart: 0,
    selectionEnd: 5
  });
});

test('italic toggles off without mistaking bold markers for italic', () => {
  assert.deepEqual(getMarkdownFormatEdit('*hello*', 1, 6, 'italic'), {
    from: 0,
    to: 7,
    text: 'hello',
    selectionStart: 0,
    selectionEnd: 5
  });
  assert.deepEqual(getMarkdownFormatEdit('*hello*', 0, 7, 'italic'), {
    from: 0,
    to: 7,
    text: 'hello',
    selectionStart: 0,
    selectionEnd: 5
  });
  assert.equal(
    getMarkdownFormatEdit('**hello**', 2, 7, 'italic').text,
    '*hello*'
  );
});

test('heading formats replace or remove the current line heading marker', () => {
  assert.equal(getMarkdownFormatEdit('## title', 4, 4, 'heading-3').text, '### title');
  assert.equal(getMarkdownFormatEdit('## title', 4, 4, 'heading-none').text, 'title');
});

test('block, math, and comment formats use Markdown wrappers', () => {
  assert.equal(getMarkdownFormatEdit('code', 0, 4, 'code-block').text, '```\ncode\n```');
  assert.equal(getMarkdownFormatEdit('x', 0, 1, 'math').text, '$x$');
  assert.equal(getMarkdownFormatEdit('a\nb', 0, 3, 'math').text, '$$\na\nb\n$$');
  assert.equal(getMarkdownFormatEdit('note', 0, 4, 'comment').text, '<!-- note -->');
});

test('insert formats create link, image, and horizontal rule Markdown', () => {
  assert.deepEqual(getMarkdownFormatEdit('OpenAI', 0, 6, 'insert-link'), {
    from: 0,
    to: 6,
    text: '[OpenAI](https://)',
    selectionStart: 9,
    selectionEnd: 17
  });
  assert.equal(
    getMarkdownFormatEdit('', 0, 0, 'insert-image').text,
    '![图片描述](图片路径)'
  );
  assert.equal(
    getMarkdownFormatEdit('before', 6, 6, 'insert-rule').text,
    '\n\n---\n\n'
  );
});

test('application menu exposes the requested format commands', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /Array\.from\(\{ length: 6 \}/);
  assert.match(main, /label: `小标题 \$\{index \+ 1\}`/);
  for (const label of [
    '无小标题', '加粗', '倾斜', '代码块', '高亮', '删除线'
  ]) {
    assert.match(main, new RegExp(`label: '${label}'`));
  }
  const formatMenu = main.slice(main.indexOf("label: '格式'"), main.indexOf("label: '视图'"));
  assert.doesNotMatch(formatMenu, /label: '数学'/);
  assert.doesNotMatch(formatMenu, /label: '注释'/);
});

test('insert menu places link, image, and rule above a separator', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const insertMenu = main.slice(main.indexOf("label: '插入'"), main.indexOf("label: '格式'"));
  const linkIndex = insertMenu.indexOf("label: '超链接'");
  const imageIndex = insertMenu.indexOf("label: '图片'");
  const ruleIndex = insertMenu.indexOf("label: '分割线'");
  const separatorIndex = insertMenu.indexOf("{ type: 'separator' }", ruleIndex);
  const tableIndex = insertMenu.indexOf("label: '表格'");

  assert.ok(linkIndex >= 0 && imageIndex > linkIndex && ruleIndex > imageIndex);
  assert.ok(separatorIndex > ruleIndex && tableIndex > separatorIndex);
});
