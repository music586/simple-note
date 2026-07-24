const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('AI optimized notes persist their state through main-process IPC', () => {
  assert.match(main, /ipcMain\.handle\('get-ai-optimized-state'/);
  assert.match(main, /ipcMain\.handle\('set-ai-optimized-state'/);
  assert.match(main, /config\.aiOptimizedNotes = \[\.\.\.new Set\(paths\)\]/);
  assert.match(main, /migrateAiOptimizedNotePaths\(oldPath, newPath\)/);
  assert.match(main, /migrateAiOptimizedNotePaths\(sourcePath, newPath\)/);
  assert.match(main, /migrateAiOptimizedNotePaths\(notePath\)/);
  assert.match(main, /migrateAiOptimizedNotePaths\(folderPath\)/);
});

test('AI optimization state restores and marks both editor panels', () => {
  assert.equal((html.match(/class="ai-layout-mark"/g) || []).length, 2);
  assert.match(html, /title="已使用 AI 优化排版"/);
  assert.match(renderer, /ipcRenderer\.invoke\('get-ai-optimized-state', note\.path\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('set-ai-optimized-state'/);
  assert.match(renderer, /targetPanel\.classList\.add\('ai-layout-optimized'\)/);
  assert.match(styles, /data-ai-stamp-position='top-right'/);
  assert.match(styles, /data-ai-stamp-position='bottom-right'/);
  assert.match(styles, /data-ai-stamp-position='corner-ribbon'/);
  assert.match(styles, /\.ai-layout-mark\s*\{[^}]*border-radius: 50%;/s);
  assert.match(styles, /\.ai-layout-mark\s*\{[^}]*right: 28px;/s);
  assert.match(
    styles,
    /data-ai-stamp-position='top-right'[\s\S]*top: 28px;[\s\S]*bottom: auto;/
  );
  assert.match(
    styles,
    /data-ai-stamp-position='bottom-right'[\s\S]*top: auto;[\s\S]*bottom: 28px;/
  );
  assert.match(
    renderer,
    /function mountAiLayoutMark\(editorAdapter, pane\)[\s\S]*querySelector\('\.CodeMirror-lines'\)[\s\S]*lines\.appendChild\(mark\)/
  );
  assert.match(
    styles,
    /\.editor-pane > \.CodeMirror \.CodeMirror-lines\s*\{[^}]*position: relative;/s
  );
  assert.match(html, /class="ai-seal-ring ai-seal-ring-outer"/);
  assert.match(html, /class="ai-seal-orbit"/);
  assert.match(html, /<small>REFINED<\/small>/);
  assert.match(styles, /\.ai-seal-ring-outer\s*\{[^}]*stroke-dasharray:/s);
  assert.match(
    styles,
    /data-ai-stamp-position='corner-ribbon'[\s\S]*width: 70px;[\s\S]*height: 70px;[\s\S]*clip-path: polygon\(18% 0, 100% 0, 100% 82%\)/
  );
});
