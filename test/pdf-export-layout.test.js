const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const printStyles = styles.slice(styles.indexOf('@media print'));

test('PDF export keeps preview typography and paginates long tables by row', () => {
  assert.match(printStyles, /\.preview-content\s*\{[^}]*font-size:\s*12pt/s);
  assert.match(printStyles, /\.preview-content\s*\{[^}]*line-height:\s*1\.8/s);
  assert.match(
    printStyles,
    /\.preview-content\s*\{[^}]*background:\s*#ffffff\s*!important/s
  );
  assert.doesNotMatch(
    printStyles,
    /\.preview-content table[^}]*break-inside:\s*avoid/s
  );
  assert.match(printStyles, /\.preview-content table\s*\{[^}]*break-inside:\s*auto/s);
  assert.match(printStyles, /\.preview-content thead\s*\{[^}]*table-header-group/s);
  assert.match(printStyles, /\.preview-content tr\s*\{[^}]*break-inside:\s*avoid/s);
});
