const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('outline is available only for wide edit-only containers and pins headings to top', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(index, /id="documentOutline"/);
  assert.match(index, /id="documentOutlineRight"/);
  assert.match(renderer, /renderDocumentOutline/);
  assert.match(
    renderer,
    /codeMirror\.scrollTo\(null, codeMirror\.heightAtLine\(heading\.line, 'local'\)\)/
  );
  assert.doesNotMatch(renderer, /codeMirror\.scrollIntoView\(\{ line: heading\.line/);
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /@container[^\{]*\(min-width:\s*1180px\)/);
  assert.match(styles, /\.editor-container\.preview-hidden \.document-outline/);
});
