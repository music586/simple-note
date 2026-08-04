const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('tree rows reserve subtle spacing without shifting on hover or selection', () => {
  assert.match(
    styles,
    /Final accent cascade[\s\S]*\.tree-folder,\s*\.tree-file \{\s*width: calc\(100% - 6px\);\s*margin: 2px 3px;/
  );
});
