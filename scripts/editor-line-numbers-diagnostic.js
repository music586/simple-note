const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({
    path: '/diagnostic',
    alias: '',
    name: '诊断目录',
    workspaceId: 1
  }));
  ipcMain.handle('get-ai-settings', () => ({ success: true, apiKey: '', model: '' }));

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      partition: `line-number-diagnostic-${Date.now()}`
    }
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (() => {
      const toggle = document.getElementById('lineNumbersToggle');
      const leftInstance = editor.codeMirror;
      const rightInstance = editorRight.codeMirror;
      const countGutters = () => ({
        left: editor.codeMirror.getWrapperElement().querySelectorAll('.cm-lineNumbers').length,
        right: editorRight.codeMirror.getWrapperElement()
          .querySelectorAll('.cm-lineNumbers').length
      });
      const initial = countGutters();
      document.querySelector('.app').classList.add('sidebar-hidden');
      document.getElementById('editorContainer').className = 'editor-container view-edit';
      toggle.click();
      const enabled = countGutters();
      const gutter = editor.codeMirror.getWrapperElement().querySelector('.cm-gutters');
      const content = editor.codeMirror.getWrapperElement().querySelector('.cm-content');
      const editorRect = editor.codeMirror.getWrapperElement().getBoundingClientRect();
      const gutterRect = gutter.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const instancesPreserved = leftInstance === editor.codeMirror
        && rightInstance === editorRight.codeMirror;
      toggle.click();
      return {
        initial,
        enabled,
        alignment: {
          editorLeft: Math.round(editorRect.left),
          gutterLeft: Math.round(gutterRect.left),
          gutterRight: Math.round(gutterRect.right),
          contentLeft: Math.round(contentRect.left),
          gap: Math.round(contentRect.left - gutterRect.right),
          color: getComputedStyle(gutter).color
        },
        disabled: countGutters(),
        instancesPreserved,
        ariaChecked: toggle.getAttribute('aria-checked')
      };
    })()
  `);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await window.close();
  app.quit();
});
