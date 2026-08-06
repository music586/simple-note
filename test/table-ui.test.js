const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSingleTableCommit, getTableAddControlState } = require('../table-ui');

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

test('a replaced table widget cannot overwrite a structural edit with a stale blur commit', () => {
  const commits = [];
  const commit = createSingleTableCommit(value => commits.push(value));

  assert.equal(commit('添加第三列'), true);
  assert.equal(commit('旧组件失焦时的两列内容'), false);
  assert.deepEqual(commits, ['添加第三列']);
});

test('Electron diagnostic covers adding a column beside an empty second row', () => {
  const diagnostic = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'editor-table-document-diagnostic.js'),
    'utf8'
  );

  assert.match(diagnostic, /const emptyRowSource =/);
  assert.match(diagnostic, /querySelector\('\.cm-table-add-column'\)/);
  assert.match(diagnostic, /emptyRowColumnAdd\.emptyRowColumns === 3/);
  assert.match(diagnostic, /result\.controlPreview =/);
  assert.match(diagnostic, /rowVisualCenterDelta <= 0\.25/);
});

test('editor cursor uses selected icon color and tables create a new caret line', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(styles, /--icon-selected:/);
  assert.match(styles, /\.cm-cursor\s*\{[^}]*var\(--icon-selected\)/s);
  assert.match(styles, /\.cm-table-widget\s*\{[^}]*display:\s*block/s);
  assert.match(styles, /\.cm-table-add\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
});

test('table insertion uses directional edge rails with themed action chips', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(renderer, /addColumnLabel\.textContent = '列'/);
  assert.match(renderer, /addRowLabel\.textContent = '行'/);
  assert.match(renderer, /addRowContent\.className = 'cm-table-add-row-content'/);
  assert.match(renderer, /在表格右侧添加一列/);
  assert.match(renderer, /在表格底部添加一行/);
  assert.match(renderer, /if \(event\.detail !== 0\) return/);
  assert.match(styles, /\.cm-table-add-column\s*\{[^}]*height:\s*100%/s);
  assert.match(styles, /\.cm-table-add-row\s*\{[^}]*width:\s*100%/s);
  assert.match(
    styles,
    /\.cm-table-add-row-content\s*\{[^}]*left:\s*50%[^}]*width:\s*54px[^}]*justify-content:\s*center[^}]*transform:\s*translate\(-50%, -50%\)/s
  );
  assert.match(
    styles,
    /\.cm-table-add-row-content \.cm-table-add-icon\s*\{[^}]*translateY\(-1\.5px\)/s
  );
  assert.match(styles, /\.cm-table-add::before\s*\{[^}]*var\(--accent-medium\)/s);
  assert.match(styles, /\.cm-table-add::after\s*\{[^}]*backdrop-filter:\s*blur\(8px\)/s);
  assert.match(styles, /\.cm-table-add-column:focus-visible/);
  assert.match(styles, /\.cm-table-add-row:focus-visible/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.cm-table-add[\s\S]*?transition:\s*none/
  );
});

test('table cells preserve line breaks as Markdown inline HTML', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(renderer, /function getTableCellDisplayText\(content\)/);
  assert.match(renderer, /replace\(\/<br\\s\*\\\/\?>\/gi, '\\n'\)/);
  assert.match(renderer, /function insertTableCellLineBreak\(cell\)/);
  assert.match(renderer, /\.replace\(\/\\n\/g, '<br>'\)/);
  assert.match(renderer, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(renderer, /if \(!widget\.isConnected \|\| widget\.contains\(document\.activeElement\)\) return;/);
  assert.match(renderer, /const replaceTable = createSingleTableCommit/);
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
