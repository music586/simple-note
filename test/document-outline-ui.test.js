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
  assert.match(
    styles,
    /\.document-outline\s*\{[^}]*height: auto;[^}]*max-height: var\(--document-outline-max-height[^;]*;[^}]*box-sizing: border-box;/s
  );
  assert.match(
    renderer,
    /const outlineTop = container\.getBoundingClientRect\(\)\.top/
  );
  assert.match(renderer, /window\.innerHeight - outlineTop \* 2/);
  assert.match(renderer, /new ResizeObserver\(\(\) => \{/);
  assert.match(
    styles,
    /\.document-outline\.collapsed\s*\{[^}]*height: 38px;[^}]*max-height: 38px;/s
  );
  assert.doesNotMatch(renderer, /codeMirror\.scrollIntoView\(\{ line: heading\.line/);
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /@container[^\{]*\(min-width:\s*1180px\)/);
  assert.match(styles, /\.editor-container\.preview-hidden \.document-outline/);
  assert.match(
    styles,
    /\.document-outline-item\.top-level\s*\{[^}]*font-weight: 600;/s
  );
});

test('outline can collapse into a persistent compact rail and expand again', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(
    renderer,
    /localStorage\.getItem\('outline-collapsed'\) === 'true'/
  );
  assert.match(renderer, /function applyDocumentOutlineCollapsedState\(\)/);
  assert.match(renderer, /container\.classList\.toggle\('collapsed', outlineCollapsed\)/);
  assert.match(renderer, /collapseButton\.className = 'document-outline-collapse'/);
  assert.match(renderer, /collapseButton\.setAttribute\('aria-expanded'/);
  assert.match(
    renderer,
    /localStorage\.setItem\('outline-collapsed', String\(outlineCollapsed\)\)/
  );
  assert.match(styles, /\.document-outline\.collapsed\s*\{/);
  assert.match(styles, /\.document-outline-collapse:focus-visible\s*\{/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test('clicking an outline item briefly highlights the target editor heading', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(renderer, /function highlightDocumentOutlineTarget\(codeMirror, lineNumber\)/);
  assert.match(
    renderer,
    /codeMirror\.addLineDecoration\(lineNumber, 'wrap', 'document-outline-target'\)/
  );
  assert.match(
    renderer,
    /codeMirror\.removeLineDecoration\(lineNumber, 'wrap', 'document-outline-target'\)/
  );
  assert.match(renderer, /highlightDocumentOutlineTarget\(codeMirror, heading\.line\)/);
  assert.match(styles, /\.document-outline-target\s*\{[^}]*animation:/s);
  assert.match(styles, /@keyframes document-outline-target-highlight/);
});
