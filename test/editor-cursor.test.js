const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getEditorCursorAlignment } = require('../editor-cursor');

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

test('active Markdown headings apply measured cursor CSS variables', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

  assert.match(renderer, /getEditorCursorAlignment/);
  assert.match(renderer, /--editor-cursor-height/);
  assert.match(renderer, /--editor-cursor-offset/);
  assert.match(styles, /height: var\(--editor-cursor-height\) !important/);
  assert.match(styles, /translateY\(var\(--editor-cursor-offset\)\)/);
});
