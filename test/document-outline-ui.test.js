const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diagnostic = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'editor-prerender-diagnostic.js'),
  'utf8'
);

const { buildOutlineTree } = require('../document-outline');

test('outline builds parents across skipped levels and separates duplicate headings', () => {
  const tree = buildOutlineTree([
    { line: 0, level: 1, text: '标题' },
    { line: 2, level: 3, text: '概述' },
    { line: 5, level: 3, text: '概述' },
    { line: 8, level: 2, text: '结语' }
  ]);
  assert.deepEqual(tree.map(node => node.depth), [0, 1, 1, 1]);
  assert.equal(tree[0].hasChildren, true);
  assert.equal(tree[1].hasChildren, false);
  assert.notEqual(tree[1].key, tree[2].key);
  assert.deepEqual(tree[3].ancestors, [tree[0].key]);
});

test('outline branch identities survive body insertions and separate parent sections', () => {
  const headings = [
    { line: 0, level: 1, text: '一' },
    { line: 1, level: 2, text: '概述' },
    { line: 3, level: 1, text: '二' },
    { line: 4, level: 2, text: '概述' }
  ];
  const before = buildOutlineTree(headings);
  const after = buildOutlineTree(headings.map(heading => ({ ...heading, line: heading.line + 10 })));
  assert.deepEqual(before.map(node => node.key), after.map(node => node.key));
  assert.notEqual(before[1].key, before[3].key);
});

test('clicking an outline item briefly highlights the target editor heading', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(renderer, /function highlightDocumentOutlineTarget\(codeMirror, lineNumber\)/);
  assert.match(
    renderer,
    /codeMirror\.addLineDecoration\(lineNumber, 'wrap', 'document-outline-target'\)/
  );
  assert.match(
    renderer,
    /codeMirror\.removeLineDecoration\(lineNumber, 'wrap', 'document-outline-target'\)/
  );
  assert.match(renderer, /highlightDocumentOutlineTarget\(codeMirror, lineNumber\)/);
  assert.match(styles, /\.document-outline-target\s*\{[^}]*animation:/s);
  assert.match(styles, /@keyframes document-outline-target-highlight/);
});

test('first outline click scrolls after decoration scroll restoration', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const navigation = renderer.match(
    /function navigateDocumentOutlineHeading\(codeMirror, lineNumber\) \{([\s\S]*?)\n\}/
  )?.[1] || '';

  assert.match(navigation, /codeMirror\.setCursor\(\{ line: lineNumber, ch: 0 \}\)/);
  assert.match(navigation, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => \{/);
  assert.match(navigation, /requestAnimationFrame\(scrollToHeading\)/);
  assert.match(diagnostic, /firstOutlineItem\?\.click\(\)/);
  assert.match(diagnostic, /result\.firstOutlineClick\.scrollDelta <= 1/);
});
