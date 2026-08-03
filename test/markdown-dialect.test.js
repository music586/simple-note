const test = require('node:test');
const assert = require('node:assert/strict');
const { Marked } = require('marked');
const hljs = require('highlight.js');
const katex = require('katex');

const { configureMarkdownDialect } = require('../markdown-dialect');

function createParser() {
  const marked = new Marked();
  configureMarkdownDialect({ marked, hljs, katex });
  return marked;
}

test('Markdown dialect renders front matter, math, callouts and wiki links', () => {
  const marked = createParser();
  const html = marked.parse([
    '---',
    'title: 测试文档',
    '---',
    '',
    '公式 $E = mc^2$',
    '',
    '> [!WARNING] 注意',
    '> 检查内容',
    '',
    '[[产品设计|设计文档]]'
  ].join('\n'));

  assert.match(html, /class="preview-frontmatter"/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="callout is-warning"/);
  assert.match(html, /class="wiki-link" href="产品设计\.md"/);
});

test('Markdown dialect escapes wiki link attributes and formula failures', () => {
  const marked = createParser();
  const wikiHtml = marked.parse('[[bad&quot; onmouseover=&quot;alert(1)|安全标签]]');
  const formulaHtml = marked.parse('$\\invalidcommand{$');

  assert.doesNotMatch(wikiHtml, /onmouseover="/);
  assert.match(formulaHtml, /class="math-error"/);
});
