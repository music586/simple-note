const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getEditorCursorAlignment,
  getFallbackTextRect,
  getCurrentLineTextRect
} = require('../editor-cursor');

const projectRoot = path.join(__dirname, '..');

test('cursor alignment uses the text height and center', () => {
  assert.deepEqual(
    getEditorCursorAlignment(
      { top: 76, height: 29.296875 },
      { top: 93, height: 22.5 }
    ),
    { height: 22.5, offset: 17 }
  );
  assert.equal(getEditorCursorAlignment(null, { top: 0, height: 10 }), null);
});

test('heading cursor follows the rendered heading height and center', () => {
  assert.deepEqual(
    getEditorCursorAlignment(
      { top: 76, height: 42 },
      { top: 88, height: 36 }
    ),
    { height: 36, offset: 12 }
  );
});

test('wrapped text uses only the visual line containing the cursor', () => {
  const cursor = { top: 108, height: 22 };
  const textRects = [
    { top: 76, height: 22 },
    { top: 105, height: 22 },
    { top: 134, height: 22 }
  ];

  assert.deepEqual(getCurrentLineTextRect(cursor, textRects), {
    top: 105,
    height: 22
  });
});

test('empty lines derive a centered text box from the editor font size', () => {
  assert.deepEqual(
    getFallbackTextRect({ top: 76, height: 29.296875 }, 16),
    { top: 79.4484375, height: 22.4 }
  );
  assert.equal(getFallbackTextRect({ top: 0, height: 20 }, 0), null);
});

test('active Markdown headings apply measured cursor CSS variables', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

  assert.match(renderer, /\.cm-editing-source-line/);
  assert.match(renderer, /getFallbackTextRect/);
  assert.match(renderer, /getCurrentLineTextRect/);
  assert.match(renderer, /codeMirror\.cursorCoords\(null, 'window'\)/);
  assert.doesNotMatch(renderer, /bodyCursorHeight/);
  assert.match(renderer, /querySelectorAll\('\.cm-editing-source-line'\)/);
  assert.match(renderer, /getClientRects\(\)/);
  assert.match(renderer, /--editor-cursor-height/);
  assert.match(renderer, /--editor-cursor-offset/);
  assert.match(styles, /height: var\(--editor-cursor-height\) !important/);
  assert.match(styles, /translateY\(var\(--editor-cursor-offset\)\)/);
});
