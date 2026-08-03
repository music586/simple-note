const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const root = document.documentElement;
      const selectedFile = document.createElement('div');
      selectedFile.className = 'tree-file active';
      selectedFile.innerHTML = '<span class="file-name">主题色诊断</span>';
      document.getElementById('notesList').appendChild(selectedFile);
      const read = () => ({
        theme: root.dataset.accent,
        accent: getComputedStyle(root).getPropertyValue('--accent-color').trim(),
        selection: getComputedStyle(root).getPropertyValue('--md-selection').trim(),
        treeSelection: getComputedStyle(selectedFile).backgroundColor,
        treeIndicator: getComputedStyle(selectedFile, '::before').backgroundColor
      });
      document.getElementById('accentThemeReset').click();
      const initial = read();
      document.querySelector('[data-accent="teal"]').click();
      const teal = read();
      const persisted = localStorage.getItem('accent-theme');
      document.getElementById('accentThemeReset').click();
      const reset = read();
      let settingsError = '';
      try {
        await showSettingsDialog();
      } catch (error) {
        settingsError = error.stack || error.message;
      }
      const settingsModal = document.getElementById('settingsModal');
      return {
        initial,
        teal,
        persisted,
        reset,
        selectedCount: document.querySelectorAll('.accent-theme-option.selected').length,
        settingsOpen: settingsModal.classList.contains('active'),
        settingsDisplay: getComputedStyle(settingsModal).display,
        settingsError
      };
    })()
  `);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const failed = result.initial.theme !== 'indigo'
    || result.teal.theme !== 'teal'
    || result.persisted !== 'teal'
    || result.initial.treeIndicator === result.teal.treeIndicator
    || result.initial.treeSelection === result.teal.treeSelection
    || result.reset.theme !== 'indigo'
    || result.selectedCount !== 1
    || !result.settingsOpen
    || result.settingsDisplay === 'none';
  window.destroy();
  app.exit(failed ? 1 : 0);
});
