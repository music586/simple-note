const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

ipcMain.handle('get-ai-settings', () => ({
  success: true,
  apiKey: '',
  layoutPrompt: '',
  configured: false,
  stampPosition: 'none'
}));
ipcMain.handle('get-image-directory-settings', () => ({
  success: true,
  mode: 'default',
  path: ''
}));
ipcMain.handle('get-hidden-directories', () => ({
  success: true,
  directories: []
}));
ipcMain.handle('get-tree', () => []);
ipcMain.handle('get-notes-info', () => ({
  path: '/tmp',
  alias: '',
  name: 'tmp'
}));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  window.focus();
  const result = await window.webContents.executeJavaScript(`
    new Promise(resolve => {
      const focusEvents = [];
      document.addEventListener('focusin', event => {
        focusEvents.push({
          tag: event.target.tagName,
          className: event.target.className || null
        });
      });
      currentNote = {
        name: 'focus-test.md',
        path: '/tmp/focus-test.md',
        type: 'file'
      };
      editor.value = '\`\`\`';
      editor.setCursorIndex(3);
      handleOpeningCodeFence(editor.codeMirror, editor);
      requestAnimationFrame(() => {
        codeLanguageSearch.value = 'js';
        codeLanguageSearch.dispatchEvent(new Event('input', { bubbles: true }));
        codeLanguageSearch.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true
        }));
        setTimeout(() => {
          const active = document.activeElement;
          const code = document.querySelector('.cm-code-widget code[contenteditable]');
          resolve({
            activeTag: active?.tagName || null,
            activeClass: active?.className || null,
            activeIsCode: active === code,
            codeConnected: Boolean(code?.isConnected),
            codeContentEditable: code?.contentEditable || null,
            pickerHidden: codeLanguagePicker.hidden,
            editorValue: editor.value,
            focusEvents
          });
        }, 250);
      });
    })
  `);

  process.stdout.write(`${JSON.stringify(result)}\n`);
  window.close();
  app.quit();
});
