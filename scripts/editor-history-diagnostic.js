const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({
    path: '/diagnostic',
    alias: '',
    name: '撤销诊断',
    workspaceId: 1
  }));
  ipcMain.handle('get-ai-settings', () => ({ success: true, apiKey: '', model: '' }));

  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      partition: `editor-history-diagnostic-${Date.now()}`
    }
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (() => {
      editor.loadDocument('/notes/a.md', '第一版');
      const initial = editor.getHistoryState();
      editor.replaceContent('AI 优化版', 'AI 排版');
      const afterEdit = { content: editor.value, ...editor.getHistoryState() };
      editor.runHistoryCommand('undo');
      const afterUndo = { content: editor.value, ...editor.getHistoryState() };
      editor.runHistoryCommand('redo');
      const afterRedo = { content: editor.value, ...editor.getHistoryState() };
      editor.loadDocument('/notes/b.md', '另一篇笔记');
      const otherNote = { content: editor.value, ...editor.getHistoryState() };
      editor.loadDocument('/notes/a.md', 'AI 优化版');
      const restored = { content: editor.value, ...editor.getHistoryState() };
      editor.runHistoryCommand('undo');
      const restoredUndo = { content: editor.value, ...editor.getHistoryState() };
      return { initial, afterEdit, afterUndo, afterRedo, otherNote, restored, restoredUndo };
    })()
  `);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await window.close();
  app.quit();
});
