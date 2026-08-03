const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const previewSecurity = fs.readFileSync(path.join(root, 'preview-security.js'), 'utf8');

test('Markdown preview is sanitized before insertion into the DOM', () => {
  assert.match(renderer, /createPreviewSanitizer\(window\)/);
  assert.match(renderer, /sanitizePreviewHtml\(previewHtml\)/);
  assert.match(previewSecurity, /createDOMPurify = require\('dompurify'\)/);
  assert.match(previewSecurity, /FORBID_TAGS: \['script', 'iframe', 'object', 'embed', 'form'\]/);
  assert.match(previewSecurity, /if \(!node\.closest\?\.\('\.katex'\)\) data\.keepAttr = false/);
});

test('main window denies document navigation and new windows', () => {
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /webContents\.on\('will-navigate', event => event\.preventDefault\(\)\)/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /frame-src 'none'/);
});
