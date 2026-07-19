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
  assert.match(renderer, /item\.dataset\.level = String\(heading\.level\)/);
  assert.match(renderer, /Math\.min\(\.\.\.headings\.map\(heading => heading\.level\)\)/);
  assert.match(renderer, /item\.classList\.toggle\('top-level', heading\.level === topHeadingLevel\)/);
  assert.match(renderer, /titleCount\.textContent = String\(headings\.length\)/);
  assert.match(renderer, /heading\.level - topHeadingLevel/);
  assert.match(renderer, /heading\.text\.replace\(\/\\\*\/g, ''\)\.trim\(\)/);
  assert.match(renderer, /function updateDocumentOutlineSelection\(/);
  assert.match(renderer, /item\.classList\.toggle\('active', active\)/);
  assert.match(renderer, /aria-current', 'location'/);
  assert.match(
    renderer,
    /codeMirror\.scrollTo\(null, codeMirror\.heightAtLine\(heading\.line, 'local'\)\)/
  );
  assert.match(styles, /\.document-outline-item\.active/);
  assert.match(styles, /\.document-outline-item\.active::before/);
  assert.match(styles, /\.document-outline::before/);
  assert.doesNotMatch(renderer, /codeMirror\.scrollIntoView\(\{ line: heading\.line/);
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /@container[^\{]*\(min-width:\s*1180px\)/);
  assert.match(styles, /\.editor-container\.preview-hidden \.document-outline/);
  assert.match(
    styles,
    /\.document-outline-item\.top-level\s*\{[^}]*font-weight: 600;/s
  );
});
