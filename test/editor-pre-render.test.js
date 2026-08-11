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
const styles = fs.readFileSync(
  path.join(__dirname, '..', 'styles.css'),
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
  assert.match(diagnostic, /result\.links === 5/);
  assert.match(diagnostic, /result\.tables === 1/);
});

test('pre-render supports safe inline HTML tags', () => {
  assert.match(renderer, /const safeInlineHtmlTags = new Set/);
  assert.match(
    renderer,
    /function createSafeInlineMarkdownFragment\(source, note, interactiveLinks = true\)/
  );
  assert.match(renderer, /function getHtmlPreviewRanges\(lineText\)/);
  assert.match(renderer, /createInlineHtmlWidget\(range\.source, note\)/);
  assert.ok(diagnostic.includes('<strong>HTML 粗体</strong>'));
  assert.ok(diagnostic.includes('<u>下划线</u>'));
  assert.ok(diagnostic.includes('H<sub>2</sub>O'));
  assert.match(diagnostic, /result\.strong >= 2/);
  assert.match(diagnostic, /result\.htmlInline === 4/);
  assert.match(
    styles,
    /\.cm-rendered-html-inline strong,[\s\S]*\.cm-rendered-html-block strong,[\s\S]*font-weight: 700;/
  );
  assert.match(diagnostic, /result\.htmlStrongWeights\.every\(weight => weight >= 700\)/);
});

test('pre-render supports safe HTML containers, paragraphs and images', () => {
  assert.match(renderer, /const safeBlockHtmlTags = new Set/);
  assert.match(renderer, /function createSafeHtmlBlockWidget\(source, note\)/);
  assert.match(renderer, /function getHtmlPreviewRanges\(lineText\)/);
  assert.match(renderer, /function getHtmlPreviewBlocks\(lines, fencedLines = new Set\(\)\)/);
  assert.match(renderer, /replaceBlockWithWidget\(block, widget, renderedSpecialLines\)/);
  assert.match(renderer, /element\.src = getImageUrl\(sourcePath, note\)/);
  assert.ok(diagnostic.includes("'  <div><strong>HTML 容器</strong></div>'"));
  assert.ok(diagnostic.includes('<p>HTML 段落</p>'));
  assert.match(diagnostic, /result\.htmlBlocks === 4/);
  assert.match(diagnostic, /result\.htmlBlockImages === 2/);
});

test('focused HTML previews restore their original source tags', () => {
  assert.match(renderer, /function replaceHtmlPreviewRange\(lineNumber, range, occupiedRanges\)/);
  assert.match(renderer, /widget\.addEventListener\('mousedown', revealSource\)/);
  assert.match(renderer, /widget\.addEventListener\('focusin', revealSource\)/);
  assert.match(renderer, /widget\.classList\.contains\('cm-rendered-html-block'\)/);
  assert.match(renderer, /const focusTarget = widget\.firstElementChild \|\| widget/);
  assert.match(renderer, /focusTarget\.addEventListener\('mousedown', event =>/);
  assert.doesNotMatch(renderer, /widget\.addEventListener\('focus', editSource\)/);
  assert.doesNotMatch(renderer, /focusTarget\.addEventListener\('focusin', editSource\)/);
  assert.match(diagnostic, /result\.htmlFocusRestoresSource/);
  assert.match(
    styles,
    /\.cm-rendered-html-block\s*\{[^}]*width: fit-content;[^}]*max-width: 100%;/s
  );
  assert.match(diagnostic, /result\.htmlBlockContentWidth < result\.htmlBlockEditorWidth \* 0\.9/);
  assert.match(renderer, /function isHtmlPreviewContentHit\(widget, clientX, clientY\)/);
  assert.match(renderer, /document\.createTreeWalker\(widget, NodeFilter\.SHOW_TEXT\)/);
  assert.match(renderer, /widget\.querySelectorAll\('img, hr'\)/);
  assert.match(renderer, /if \(!isHtmlPreviewContentHit\(widget, event\.clientX, event\.clientY\)\)/);
  assert.match(renderer, /event\.target\.closest\('\.cm-rendered-html-block'\)/);
  assert.match(renderer, /document\.addEventListener\('mousedown', event => \{/);
  assert.match(renderer, /\}, true\);/);
  assert.match(diagnostic, /result\.htmlBlankAreaIgnored/);
});

test('every supported HTML preview uses the same source focus behavior', () => {
  assert.match(renderer, /createSafeInlineMarkdownFragment\(source, note, false\)/);
  assert.match(renderer, /replaceHtmlPreviewRange\(lineNumber, range, occupiedRanges\)/);
  assert.doesNotMatch(renderer, /const html(?:Block|Inline|Link)Pattern/);
  assert.match(renderer, /\|ul\|ol\|li\)\\b/);
  assert.match(renderer, /<\(\?:img\|hr\)\\b/);
  assert.match(diagnostic, /result\.htmlLinkFocusRestoresSource/);
});

test('HTML source returns to pre-render when the editor loses focus', () => {
  assert.match(
    renderer,
    /if \(!focused\) return hasSourceVisibilityChange \? 'blurred' : 'stable'/
  );
  assert.match(renderer, /const activeLine = wrapper\.contains\(document\.activeElement\)/);
  assert.match(renderer, /htmlBlocks: getHtmlPreviewBlocks\(lines, fencedLines\)/);
  assert.match(renderer, /editor\.codeMirror\.on\('blur'/);
  assert.match(renderer, /editorRight\.codeMirror\.on\('blur'/);
  const cursorStateSource = renderer.slice(
    renderer.indexOf('function getEditorDecorationCursorState'),
    renderer.indexOf('function scheduleCursorEditorDecorations')
  );
  assert.ok(cursorStateSource.indexOf('if (!focused)') < cursorStateSource.indexOf('if (listPrefix)'));
  assert.match(diagnostic, /result\.htmlBlurRestoresPreview/);
});

test('active line only reveals HTML source while the cursor is inside its tag range', () => {
  assert.match(renderer, /function getHtmlPreviewRanges\(lineText\)/);
  assert.match(
    renderer,
    /if \(activeCursor\.ch >= range\.from && activeCursor\.ch <= range\.to\) return;/
  );
  assert.match(renderer, /`line:\$\{cursor\.line\}:html:\$\{activeHtmlRange\.from\}-/);
  assert.match(renderer, /`line:\$\{cursor\.line\}:html:outside`/);
});

test('Markdown highlighting does not override application pre-render styles', () => {
  assert.match(adapter, /const markdownHighlightStyle = HighlightStyle\.define/);
  assert.match(adapter, /tag: tags\.heading[\s\S]*textDecoration: 'none'/);
  assert.match(adapter, /tag: \[tags\.link, tags\.url\][\s\S]*textDecoration: 'none'/);
  assert.doesNotMatch(adapter, /defaultHighlightStyle/);
});

test('list prefixes render as soon as the marker-ending space is entered', () => {
  assert.match(markdownStructure, /return cursorCh >= listPrefix\.toCh/);
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
