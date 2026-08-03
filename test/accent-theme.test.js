const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('settings offer three accessible accent themes and a default reset', () => {
  assert.match(html, /id="accentThemeOptions"[^>]*role="radiogroup"/);
  assert.equal((html.match(/<button class="accent-theme-option/g) || []).length, 3);
  assert.match(html, /data-accent="indigo"[^>]*aria-checked="true"/);
  assert.match(html, /data-accent="teal"/);
  assert.match(html, /data-accent="amber"/);
  assert.match(html, /id="accentThemeReset"/);
});

test('accent selection persists, synchronizes across windows and resets to indigo', () => {
  assert.match(renderer, /localStorage\.getItem\('accent-theme'\)/);
  assert.match(renderer, /localStorage\.setItem\('accent-theme', accentTheme\)/);
  assert.match(renderer, /document\.documentElement\.dataset\.accent = accentTheme/);
  assert.match(renderer, /event\.key === 'accent-theme'/);
  assert.match(renderer, /accentThemeReset\.addEventListener\('click', \(\) => setAccentTheme\('indigo'\)\)/);
  const aiStampFunction = renderer.slice(
    renderer.indexOf('function applyAiStampPosition('),
    renderer.indexOf('function getSettingsErrorMessage(')
  );
  assert.doesNotMatch(aiStampFunction, /accentThemeOptions/);
  assert.match(
    renderer,
    /function setSettingsBusy\(busy\)[\s\S]*accentThemeOptions\.forEach/
  );
});

test('all accent palettes define dark and light semantic highlight colors', () => {
  ['indigo', 'teal', 'amber'].forEach(theme => {
    assert.match(styles, new RegExp(`:root\\[data-accent='${theme}'\\]`));
    assert.match(styles, new RegExp(
      `:root\\[data-theme='light'\\]\\[data-accent='${theme}'\\]`
    ));
  });
  assert.match(styles, /--accent-soft:/);
  assert.match(styles, /--accent-strong:/);
  assert.match(styles, /--icon-selected:/);
  assert.match(styles, /--md-accent:/);
  assert.match(styles, /--md-selection:/);
  assert.match(styles, /\.cm-selectionBackground[\s\S]*var\(--md-selection\)/);
  assert.match(styles, /\.cm-cursor[\s\S]*var\(--icon-selected\)/);
  assert.match(
    styles,
    /Final accent cascade[\s\S]*\.tree-file\.active[\s\S]*var\(--accent-color\) 11%/
  );
  assert.match(
    styles,
    /\.quick-open-result\[aria-selected='true'\][\s\S]*var\(--accent-soft\)/
  );
  assert.match(
    styles,
    /\.cm-find-match-current[\s\S]*var\(--accent-color\)/
  );
});
