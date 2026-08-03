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
  assert.match(styles, /\.cm-cursor\s*\{[^}]*var\(--icon-selected\)/s);
  assert.match(styles, /\.cm-table-widget\s*\{[^}]*display:\s*block/s);
  assert.match(styles, /\.cm-table-add\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
});

test('table cells preserve line breaks as Markdown inline HTML', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(renderer, /function getTableCellDisplayText\(content\)/);
  assert.match(renderer, /replace\(\/<br\\s\*\\\/\?>\/gi, '\\n'\)/);
  assert.match(renderer, /function insertTableCellLineBreak\(cell\)/);
  assert.match(renderer, /\.replace\(\/\\n\/g, '<br>'\)/);
  assert.match(renderer, /event\.metaKey \|\| event\.ctrlKey/);
  assert.doesNotMatch(renderer, /replace\(\/\\s\*\\n\\s\*\/g, ' '\)/);
  assert.match(styles, /\.cm-table-widget th,[\s\S]*white-space: pre-wrap;/);
});

test('wide editor tables keep readable columns and scroll inside the editor page', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(styles, /\.cm-table-viewport\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.cm-table-widget table\s*\{[^}]*min-width:\s*100%/s);
  assert.match(styles, /\.cm-table-widget table\s*\{[^}]*max-width:\s*none/s);
  assert.match(styles, /\.cm-table-widget th,[\s\S]*min-width:\s*7\.5em;/);
  assert.match(styles, /\.cm-table-widget th,[\s\S]*word-break:\s*normal;/);
});
