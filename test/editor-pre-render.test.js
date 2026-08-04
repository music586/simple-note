const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(
  path.join(__dirname, '..', 'renderer.js'),
  'utf8'
);
const adapter = fs.readFileSync(
  path.join(__dirname, '..', 'codemirror6-adapter.js'),
  'utf8'
);
const markdownStructure = fs.readFileSync(
  path.join(__dirname, '..', 'markdown-structure.js'),
  'utf8'
);
const diagnostic = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'editor-prerender-diagnostic.js'),
  'utf8'
);

test('pre-render determines fenced code state independently for every visible line', () => {
  assert.match(
    renderer,
    /const containingCodeBlock = findContainingCodeBlock\(codeBlocks, lineNumber\)/
  );
  assert.match(renderer, /function findContainingCodeBlock\(codeBlocks, lineNumber\)/);
  assert.match(
    renderer,
    /const inCodeFence = Boolean\(containingCodeBlock && !fenceLine\)/
  );
  assert.doesNotMatch(renderer, /let inCodeFence = codeBlocks\.some/);
  assert.doesNotMatch(renderer, /inCodeFence = !inCodeFence/);
});

test('CM6 pre-render regression covers inline marks links and block widgets', () => {
  for (const selector of [
    'cm-rendered-heading',
    'cm-rendered-strong',
    'cm-rendered-em',
    'cm-rendered-strike',
    'cm-rendered-highlight',
    'cm-rendered-code',
    'cm-rendered-link',
    'cm-rendered-quote',
    'cm-rendered-list-line',
    'cm-rendered-checkbox',
    'cm-rendered-rule',
    'cm-table-widget',
    'cm-code-widget',
    'cm-frontmatter-widget',
    'cm-math-widget',
    'cm-callout-widget',
    'is-wiki-link',
    'cm-rich-inline-widget'
  ]) {
    assert.match(diagnostic, new RegExp(selector));
  }
  assert.match(diagnostic, /result\.links === 3/);
  assert.match(diagnostic, /result\.tables === 1/);
});

test('Markdown highlighting does not override application pre-render styles', () => {
  assert.match(adapter, /const markdownHighlightStyle = HighlightStyle\.define/);
  assert.match(adapter, /tag: tags\.heading[\s\S]*textDecoration: 'none'/);
  assert.match(adapter, /tag: \[tags\.link, tags\.url\][\s\S]*textDecoration: 'none'/);
  assert.doesNotMatch(adapter, /defaultHighlightStyle/);
});

test('active Markdown prefixes reveal their source when the cursor moves next to them', () => {
  assert.match(markdownStructure, /return cursorCh > listPrefix\.toCh/);
  assert.match(
    renderer,
    /if \(activeCursor\.ch > activeQuote\.source\.length\) \{[\s\S]*?collapsed: true/
  );
  assert.match(renderer, /const activeCursor = codeMirror\.getCursor\(\);/);
});

test('nested Markdown quotes render every source prefix with a bounded depth class', () => {
  assert.match(renderer, /function getRenderedQuotePrefix\(lineText\)/);
  assert.match(renderer, /depth: \(match\[0\]\.match\(\/>\/g\) \|\| \[\]\)\.length/);
  assert.match(renderer, /cm-rendered-quote-depth-\$\{Math\.min\(quote\.depth, 6\)\}/);
  assert.match(renderer, /ch: quote\.source\.length/);
});
