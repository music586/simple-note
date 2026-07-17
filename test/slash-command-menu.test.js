const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('slash command menu has accessible listbox markup and safe option rendering', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

  assert.match(
    html,
    /id="slashCommandMenu"[^>]*role="listbox"[^>]*aria-label="Markdown 结构"[^>]*hidden/
  );
  assert.match(renderer, /label\.textContent = command\.label/);
  assert.match(renderer, /option\.addEventListener\('mousemove'/);
  assert.doesNotMatch(renderer, /option\.addEventListener\('mouseenter'/);
  assert.doesNotMatch(renderer, /slashCommandMenuElement\.innerHTML/);
  assert.match(styles, /--slash-command-selected-bg:/);
  assert.match(
    styles,
    /\.slash-command-option\[aria-selected='true'\][^{]*\{[^}]*var\(--slash-command-selected-bg\)/s
  );
  assert.doesNotMatch(styles, /var\(--bg-hover\)/);
});
