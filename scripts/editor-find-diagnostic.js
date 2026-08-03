const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({
    path: '',
    alias: '',
    name: ''
  }));

  const window = new BrowserWindow({
    width: 1800,
    height: 720,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    new Promise(async resolve => {
      const waitFrames = count => new Promise(next => {
        const step = () => count-- > 0 ? requestAnimationFrame(step) : next();
        requestAnimationFrame(step);
      });
      const dispatchFind = () => document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true
      }));
      const input = document.getElementById('editorFindInput');
      const bar = document.getElementById('editorFindBar');
      const count = document.getElementById('editorFindCount');

      currentNote = { path: ${JSON.stringify(path.join(__dirname, '..', 'diagnostic.md'))} };
      editor.codeMirror.setValue([
        '# Alpha 查找测试',
        '',
        'Alpha 是第一个命中。',
        '这里还有 alpha。',
        '最后一个 ALPHA。'
      ].join('\\n'));
      editor.codeMirror.setCursor({ line: 0, ch: 0 });
      editor.codeMirror.focus();
      dispatchFind();
      input.value = 'alpha';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await waitFrames(3);

      const opened = {
        hidden: bar.hidden,
        panel: bar.parentElement.id,
        count: count.textContent,
        matches: document.querySelectorAll('.cm-find-match').length,
        current: document.querySelectorAll('.cm-find-match-current').length
      };

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      await waitFrames(2);
      const nextCount = count.textContent;

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      }));
      const closed = {
        hidden: bar.hidden,
        matches: document.querySelectorAll('.cm-find-match').length
      };

      rightPanel.style.display = 'flex';
      editorRight.codeMirror.refresh();
      editorRight.codeMirror.setValue('右栏 alpha');
      editorRight.codeMirror.focus();
      dispatchFind();
      await waitFrames(2);
      const rightPanelId = bar.parentElement.id;

      rightPanel.style.display = 'none';
      editorContainer.classList.remove('view-both', 'view-preview');
      editorContainer.classList.add('view-edit');
      editor.codeMirror.focus();
      lastActiveEditor = editor;
      editor.codeMirror.setCursor({ line: 0, ch: 0 });
      dispatchFind();
      await waitFrames(2);

      resolve({ opened, nextCount, closed, rightPanelId });
    })
  `);

  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(
    path.join('/private/tmp', 'simple-note-editor-find.png'),
    screenshot.toPNG()
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const passed = result.opened.hidden === false
    && result.opened.panel === 'leftPanel'
    && result.opened.count === '1 / 4'
    && result.opened.matches === 4
    && result.opened.current === 1
    && result.nextCount === '2 / 4'
    && result.closed.hidden === true
    && result.closed.matches === 0
    && result.rightPanelId === 'rightPanel';
  await window.close();
  app.exit(passed ? 0 : 1);
});
