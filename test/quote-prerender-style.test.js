const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('Markdown quotes use themed guides and body-colored text', () => {
  assert.match(
    styles,
    /\.cm-rendered-quote-line \{[^}]*background-image: linear-gradient\(var\(--accent-strong\)/s
  );
  assert.match(
    styles,
    /\.cm-rendered-quote-line \{[^}]*margin-top: 0;[^}]*margin-bottom: 0;/s
  );
  assert.match(styles, /\.cm-rendered-quote-depth-2 \{/);
  assert.match(styles, /\.cm-rendered-quote-depth-6/);
  assert.match(styles, /\.cm-rendered-strike,\s*\.cm-rendered-quote \{[^}]*var\(--md-body\)/s);
  assert.match(styles, /\.cm-rendered-quote \{[^}]*font-style: normal/s);
  assert.match(styles, /\.cm-editing-source-line\.cm-editing-quote \{[^}]*font-style: normal/s);
});

test('adjacent quote lines join into one uninterrupted guide', () => {
  const quoteRule = styles.match(/\.cm-rendered-quote-line \{([^}]*)\}/s)?.[1] || '';
  assert.doesNotMatch(quoteRule, /margin-(?:top|bottom): [^0]/);
  assert.match(quoteRule, /background-size: 2px 100%/);
});

test('reading preview quotes match the simplified editor treatment', () => {
  assert.match(
    styles,
    /\.preview-content blockquote \{[^}]*padding-left: 12px;[^}]*border-left: 3px solid var\(--accent-strong\)/s
  );
  assert.match(styles, /\.preview-content blockquote blockquote \{[^}]*var\(--accent-medium\)/s);
  assert.match(styles, /\.preview-content blockquote > :last-child \{[^}]*margin-bottom: 0/s);
});
