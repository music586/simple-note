const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const documentPath = process.argv[2];
if (!documentPath || !fs.existsSync(documentPath)) {
  process.stderr.write('请提供存在的 Markdown 文件路径\n');
  process.exit(2);
}

const source = fs.readFileSync(documentPath, 'utf8');
const outputDir = path.join(__dirname, '..', 'tmp', 'pdfs');

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({ path: '', alias: '', name: '' }));
  ipcMain.handle('get-ai-settings', () => ({ success: true, apiKey: '', model: '' }));

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  await window.webContents.executeJavaScript(`
    (async () => {
      currentNote = { path: ${JSON.stringify(documentPath)}, name: 'PDF 排版诊断' };
      editor.value = ${JSON.stringify(source)};
      app.classList.add('reading-mode', 'exporting-pdf');
      updatePreview(true);
      await document.fonts.ready;
      await new Promise(resolve => setTimeout(resolve, 500));
      const preview = document.getElementById('preview');
      const style = getComputedStyle(preview);
      return {
        width: Math.round(preview.getBoundingClientRect().width),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paragraphs: preview.querySelectorAll('p').length,
        tables: preview.querySelectorAll('table').length,
        codeBlocks: preview.querySelectorAll('pre').length
      };
    })()
  `).then(result => process.stdout.write(`${JSON.stringify(result)}\n`));

  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'pdf-preview.png'), screenshot.toPNG());
  const pdf = await window.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    preferCSSPageSize: true
  });
  fs.writeFileSync(path.join(outputDir, 'pdf-layout-diagnostic.pdf'), pdf);
  await window.close();
  app.quit();
});
