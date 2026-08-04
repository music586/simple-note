const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const readingStyles = fs.readFileSync(path.join(root, 'export-reading.css'), 'utf8');

test('文件菜单提供单文件 HTML 导出入口', () => {
  assert.match(main, /label: '导出 HTML…'[\s\S]*sendToActiveWindow\('export-html'\)/);
  assert.match(main, /ipcMain\.handle\('export-current-html'/);
  assert.match(main, /fs\.writeFileSync\(result\.filePath, payload\.html, 'utf-8'\)/);
});

test('PDF 和 HTML 导出项在文件菜单中形成独立区域', () => {
  assert.match(
    main,
    /label: '保存',[\s\S]*sendToActiveWindow\('save-note'\)[\s\S]*\},\s*\{ type: 'separator' \},\s*\{\s*label: '导出 PDF…',[\s\S]*label: '导出 HTML…',[\s\S]*\},\s*\{ type: 'separator' \}/
  );
});

test('HTML 导出复用阅读预览并内嵌样式和图片', () => {
  assert.match(
    renderer,
    /await renderMarkdownPreview\(exportPreview, targetEditor\.value, targetEditor, targetNote\)/
  );
  assert.match(renderer, /await inlineExportImages\(exportPreview\)/);
  assert.match(renderer, /<style>\$\{readingStyles\}<\/style>/);
  assert.match(renderer, /data:\$\{getExportImageMimeType\(filePath\)\};base64,/);
  assert.match(renderer, /class=\\?"preview-content export-reading-page\\?"/);
});

test('HTML 导出跟随双栏中当前聚焦的笔记', () => {
  assert.match(
    renderer,
    /const useRightEditor = lastActiveEditor === editorRight && currentNoteRight;/
  );
  assert.match(renderer, /const saveTargetNote = useRightEditor \? saveCurrentNoteRight : saveCurrentNote;/);
  assert.match(renderer, /suggestedName: targetNote\.name/);
});

test('HTML 导出保留当前深浅主题和主题色', () => {
  assert.match(renderer, /const theme = colorTheme === 'light' \? 'light' : 'dark'/);
  assert.match(renderer, /document\.documentElement\.dataset\.accent \|\| 'indigo'/);
  assert.match(renderer, /data-theme=\\?"\$\{theme\}\\?" data-accent=/);
});

test('长篇 HTML 文档解除应用壳层的视口锁定并允许纵向滚动', () => {
  assert.match(
    readingStyles,
    /html \{[^}]*height: auto;[^}]*overflow-y: auto;/s
  );
  assert.match(
    readingStyles,
    /body \{[^}]*height: auto;[^}]*min-height: 100vh;[^}]*overflow-y: visible;/s
  );
  assert.match(
    readingStyles,
    /\.export-reading-page \{[^}]*min-height: 100vh;[^}]*overflow: visible;/s
  );
});

test('HTML 只内嵌阅读样式且不会记录失败图片的原始路径', () => {
  assert.match(renderer, /path\.join\(__dirname, 'export-reading\.css'\)/);
  assert.doesNotMatch(renderer, /path\.join\(__dirname, 'styles\.css'\)/);
  assert.doesNotMatch(renderer, /dataset\.exportSource/);
  assert.match(renderer, /catch \{\s*image\.removeAttribute\('src'\);/);
  assert.match(readingStyles, /\.preview-frontmatter/);
  assert.match(readingStyles, /\.preview-math-block/);
  assert.match(readingStyles, /\.mermaid-diagram/);
});

test('保存、渲染和图片内嵌都由 HTML 导出的错误处理覆盖', () => {
  assert.match(
    renderer,
    /async function exportCurrentNoteToHtml\(\)[\s\S]*try \{\s*await saveTargetNote\(\);\s*const exportPreview[\s\S]*await inlineExportImages\(exportPreview\);[\s\S]*\} catch \(err\)/
  );
});
