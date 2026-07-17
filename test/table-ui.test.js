const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getTableAddControlState } = require('../table-ui');

test('table add control selects the closest edge without moving from its center', () => {
  const rect = { left: 100, top: 50, right: 500, bottom: 250, width: 400, height: 200 };

  assert.deepEqual(getTableAddControlState(rect, 496, 90), {
    type: 'column'
  });
  assert.deepEqual(getTableAddControlState(rect, 180, 246), {
    type: 'row'
  });
});

test('table add control ignores areas away from the right and bottom edges', () => {
  const rect = { left: 100, top: 50, right: 500, bottom: 250, width: 400, height: 200 };

  assert.deepEqual(getTableAddControlState(rect, 499, 51), { type: 'column' });
  assert.equal(getTableAddControlState(rect, 101, 100), null);
});

test('editor cursor uses selected icon color and tables create a new caret line', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(styles, /--icon-selected:/);
  assert.match(styles, /\.CodeMirror-cursor\s*\{[^}]*var\(--icon-selected\)/s);
  assert.match(styles, /\.cm-table-widget\s*\{[^}]*display:\s*block/s);
  assert.match(styles, /\.cm-table-add\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
});
