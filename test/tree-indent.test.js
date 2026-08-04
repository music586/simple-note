const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('each tree level adds exactly one character-width indent', () => {
  assert.match(renderer, /folderEl\.style\.paddingLeft = `calc\(8px \+ \$\{level\}em\)`/);
  assert.match(renderer, /fileEl\.style\.paddingLeft = `calc\(32px \+ \$\{level\}em\)`/);
  assert.match(styles, /\.tree-folder-children \{[^}]*margin-left: 0;/s);
  assert.doesNotMatch(renderer, /level \* 16/);
});
