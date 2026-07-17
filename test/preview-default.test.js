const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('preview defaults to collapsed while preserving an explicit expanded preference', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(
    renderer,
    /previewHiddenLeft = localStorage\.getItem\('preview-hidden-left'\) !== 'false'/
  );
  assert.match(
    renderer,
    /previewHiddenRight = localStorage\.getItem\('preview-hidden-right'\) !== 'false'/
  );
});
