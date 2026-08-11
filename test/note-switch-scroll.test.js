const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('switching a sidebar note resets the editor and preview to the top', () => {
  assert.match(renderer, /function resetPaneScrollToTop\(editorAdapter, previewElement\)/);
  assert.match(renderer, /editorAdapter\.codeMirror\.scrollTo\(0, 0\)/);
  assert.match(renderer, /previewElement\.scrollTop = 0/);
  assert.match(
    renderer,
    /async function selectNote[\s\S]*updatePreview\(true\);\s*resetPaneScrollToTop\(editor, preview\)/
  );
});

test('scroll reset survives decoration frames and ignores stale note switches', () => {
  assert.match(renderer, /const paneScrollResetVersions = new WeakMap\(\)/);
  assert.match(renderer, /paneScrollResetVersions\.get\(editorAdapter\) !== version/);
  assert.match(
    renderer,
    /requestAnimationFrame\(\(\) => \{\s*reset\(\);\s*requestAnimationFrame\(reset\)/
  );
});

test('opening a note in the second pane also starts at the top', () => {
  assert.match(
    renderer,
    /async function openInRightPanel[\s\S]*resetPaneScrollToTop\(editorRight, previewRight\)/
  );
});
