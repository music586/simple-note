const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('active image lines keep their Markdown source and preview visible', () => {
  const activeLineBranch = renderer.indexOf('if (lineNumber === activeLine)');
  const activeListBranch = renderer.indexOf('const activeListPrefix', activeLineBranch);
  assert.ok(activeLineBranch >= 0);
  assert.ok(activeListBranch > activeLineBranch);
  assert.match(
    renderer.slice(activeLineBranch, activeListBranch),
    /addLineWidget\(lineNumber, widget/
  );
  assert.match(renderer, /widget\.classList\.add\('is-source-visible'\)/);
});

test('pressing an image preview selects it without moving the editor cursor', () => {
  assert.match(renderer, /widget\.addEventListener\('mousedown', event => \{/);
  assert.match(renderer, /widget\.classList\.toggle\('is-selected'\)/);
  const imageWidgetFactory = renderer.slice(
    renderer.indexOf('function createImageWidget'),
    renderer.indexOf('Array.from(editorAdapter.collapsedHeadings)')
  );
  assert.doesNotMatch(imageWidgetFactory, /codeMirror\.setCursor/);
});
