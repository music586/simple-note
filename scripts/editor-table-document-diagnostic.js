const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const documentPath = process.argv[2];
if (!documentPath || !fs.existsSync(documentPath)) {
  process.stderr.write('请提供存在的 Markdown 文件路径\n');
  process.exit(2);
}
const source = fs.readFileSync(documentPath, 'utf8');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({ path: '', alias: '', name: '' }));
  ipcMain.handle('get-ai-settings', () => ({ apiKey: '', model: '' }));

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const source = ${JSON.stringify(source)};
      const errors = [];
      window.addEventListener('error', event => errors.push(event.message));
      window.addEventListener('unhandledrejection', event => {
        errors.push(String(event.reason?.message || event.reason));
      });
      currentNote = { path: ${JSON.stringify(documentPath)} };
      editor.value = source;
      editor.setCursorIndex(source.length);
      updatePreview(true);
      const codeMirror = editor.codeMirror;
      const root = codeMirror.getWrapperElement();
      const wait = () => new Promise(resolve => setTimeout(resolve, 180));
      const samples = [];
      for (let line = 0; line < codeMirror.lineCount(); line += 20) {
        codeMirror.scrollTo(null, codeMirror.heightAtLine(line, 'local'));
        await wait();
        root.querySelectorAll('.cm-table-widget').forEach(table => {
          const rect = table.getBoundingClientRect();
          const viewport = table.querySelector('.cm-table-viewport');
          const tableElement = table.querySelector('table');
          const tableRect = tableElement.getBoundingClientRect();
          const key = table.innerText.slice(0, 80);
          if (samples.some(sample => sample.key === key)) return;
          samples.push({
            key,
            rows: tableElement.rows.length,
            columns: tableElement.rows[0]?.cells.length || 0,
            widgetHeight: Math.round(rect.height),
            tableHeight: Math.round(tableRect.height),
            scrollWidth: viewport.scrollWidth,
            clientWidth: viewport.clientWidth,
            horizontalScroll: viewport.scrollWidth > viewport.clientWidth + 1,
            clippedHeight: tableRect.height > rect.height + 1
          });
        });
      }
      const targetLine = source.split('\\n').findIndex(line => line.startsWith('| 功能场景'));
      codeMirror.scrollTo(null, codeMirror.heightAtLine(targetLine, 'local'));
      await wait();
      return { lines: codeMirror.lineCount(), samples, errors };
    })()
  `);
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync('/private/tmp/simple-note-table-document.png', screenshot.toPNG());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await window.close();
  app.exit(result.errors.length ? 1 : 0);
});
