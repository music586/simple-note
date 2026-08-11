const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('preview images open in an accessible large-image viewer', () => {
  assert.match(renderer, /imageViewer\.className = 'modal image-viewer'/);
  assert.match(renderer, /function openImageViewer\(image\)/);
  assert.match(renderer, /const image = event\.target\.closest\('img'\)/);
  assert.match(renderer, /if \(image && container\.contains\(image\)\)/);
  assert.match(renderer, /imageViewerImage\.src = image\.currentSrc \|\| image\.src/);
  assert.match(renderer, /imageViewerImage\.alt = image\.alt \|\| '预览图片'/);
  assert.match(renderer, /imageViewerClose\.focus\(\{ preventScroll: true \}\)/);
});

test('image viewer closes from its button, backdrop and Escape', () => {
  assert.match(renderer, /imageViewerClose\.addEventListener\('click', closeImageViewer\)/);
  assert.match(
    renderer,
    /imageViewer\.addEventListener\('click',[\s\S]*event\.target === imageViewer[\s\S]*closeImageViewer/
  );
  assert.match(
    renderer,
    /if \(imageViewer\.classList\.contains\('active'\)\)[\s\S]*closeImageViewer\(\)/
  );
});

test('closing the image viewer does not exit focused reading mode', () => {
  assert.match(
    renderer,
    /document\.addEventListener\('pointerdown',[\s\S]*document\.querySelector\('\.modal\.active'\)[\s\S]*return;/
  );
  assert.doesNotMatch(
    renderer,
    /function closeImageViewer\(\)[\s\S]*?exit-reading-mode[\s\S]*?\n\}/
  );
});

test('image viewer uses a bounded scrollable canvas and zoom cursor', () => {
  assert.match(styles, /\.preview-content img\s*\{[^}]*cursor: zoom-in;/s);
  assert.match(styles, /\.image-viewer-canvas\s*\{[^}]*overflow: auto;/s);
  assert.match(styles, /\.image-viewer-image\s*\{[^}]*max-width: none;/s);
  assert.match(styles, /\.image-viewer-close:focus-visible\s*\{/);
});
