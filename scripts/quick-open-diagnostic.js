const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const notes = [
  {
    type: 'folder',
    name: '产品',
    path: '/diagnostic/产品',
    children: [
      { type: 'file', name: '版本升级.md', path: '/diagnostic/产品/版本升级.md' }
    ]
  },
  { type: 'file', name: '随手记.md', path: '/diagnostic/随手记.md' }
];

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => notes);
  ipcMain.handle('get-notes-info', () => ({ path: '/diagnostic', name: '诊断目录' }));
  ipcMain.handle('get-ai-settings', () => ({ success: true, apiKey: '', model: '' }));
  ipcMain.handle('read-note', (event, notePath) => `已打开：${notePath}`);
  ipcMain.handle('get-ai-optimized-state', () => ({ success: true, optimized: false }));

  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      await loadTree();
      showQuickOpen();
      const input = document.getElementById('quickOpenInput');
      input.value = '版本';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const beforeOpen = {
        active: document.getElementById('quickOpenModal').classList.contains('active'),
        results: document.querySelectorAll('.quick-open-result').length,
        selected: document.querySelector('.quick-open-result[aria-selected="true"]')
          ?.innerText
      };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 120));
      return {
        ...beforeOpen,
        closed: !document.getElementById('quickOpenModal').classList.contains('active'),
        noteName: currentNote?.name,
        editorValue: editor.value
      };
    })()
  `);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await window.close();
  app.quit();
});
