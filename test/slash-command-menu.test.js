const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('slash command menu has accessible listbox markup and safe option rendering', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');

  assert.match(
    html,
    /id="slashCommandMenu"[^>]*role="listbox"[^>]*aria-label="Markdown 结构"[^>]*hidden/
  );
  assert.match(renderer, /label\.textContent = command\.label/);
  assert.doesNotMatch(renderer, /slashCommandMenuElement\.innerHTML/);
});
