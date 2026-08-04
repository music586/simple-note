const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('tree folders animate arrows and child rows in both directions', () => {
  assert.match(renderer, /async function toggleTreeFolder\(folderPath, folderEl\)/);
  assert.match(renderer, /rotate\(90deg\)[\s\S]*rotate\(0deg\)/);
  assert.match(renderer, /rotate\(0deg\)[\s\S]*rotate\(90deg\)/);
  assert.match(renderer, /height: '0', opacity: 0, transform: 'translateY\(-5px\)'/);
  assert.match(renderer, /expandTiming[^\n]*cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(renderer, /collapseTiming[^\n]*cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
  assert.match(renderer, /arrowExpandTiming[^\n]*cubic-bezier\(0\.34, 1\.36, 0\.64, 1\)/);
  assert.match(renderer, /opacity: 0\.76[\s\S]*opacity: 1/);
  assert.match(styles, /\.tree-folder-children \{[^}]*overflow: hidden/s);
});

test('tree motion respects reduced-motion preferences and ignores repeat clicks', () => {
  assert.match(renderer, /animatingTreeFolders\.has\(folderPath\)/);
  assert.match(renderer, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
