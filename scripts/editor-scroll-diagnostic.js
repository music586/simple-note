const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  const window = new BrowserWindow({
    width: 1000,
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
      const cm = document.querySelector('#leftPanel .cm-editor').simpleNoteEditor;
      const projectPath = ${JSON.stringify(path.join(__dirname, '..', 'diagnostic.md'))};
      const lines = [
        ...Array.from({ length: 12 }, (_, index) => '图片前 ' + index),
        '![诊断图片](icon.png)',
        ...Array.from({ length: 22 }, (_, index) => '图片后 ' + index),
        '\`\`\`javascript',
        ...Array.from({ length: 12 }, (_, index) => 'const value' + index + ' = ' + index + ';'),
        '\`\`\`',
        ...Array.from({ length: 30 }, (_, index) => '代码后 ' + index)
      ];
      const waitFrames = count => new Promise(next => {
        const step = () => count-- > 0 ? requestAnimationFrame(step) : next();
        requestAnimationFrame(step);
      });
      const sample = (stage, targetLine) => ({
        stage,
        scrollTop: cm.getScrollInfo().top,
        cursor: cm.getCursor(),
        targetTop: cm.cursorCoords({ line: targetLine, ch: 0 }, 'local').top,
        imageWidgets: cm.getWrapperElement().querySelectorAll('.cm-image-widget').length,
        codeWidgets: cm.getWrapperElement().querySelectorAll('.cm-code-widget').length
      });

      currentNote = { path: projectPath };
      cm.setValue(lines.join('\\n'));
      cm.setCursor({ line: 12, ch: 3 });
      renderEditorDecorations(editor, { path: projectPath });
      await waitFrames(4);
      const image = cm.getWrapperElement().querySelector('.cm-image-widget img');
      if (image && !image.complete) {
        await new Promise(next => {
          image.addEventListener('load', next, { once: true });
          image.addEventListener('error', next, { once: true });
        });
      }
      await waitFrames(4);

      const targetLine = 26;
      cm.scrollTo(null, cm.heightAtLine(18, 'local'));
      await waitFrames(2);
      const samples = [sample('before-click', targetLine)];
      const coords = cm.cursorCoords({ line: targetLine, ch: 3 }, 'window');
      const target = document.elementFromPoint(coords.left, coords.top + 3);
      target.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: coords.left,
        clientY: coords.top + 3
      }));
      target.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: coords.left,
        clientY: coords.top + 3
      }));
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: coords.left,
        clientY: coords.top + 3
      }));
      samples.push(sample('after-click', targetLine));
      await waitFrames(1);
      samples.push(sample('after-one-frame', targetLine));
      await waitFrames(4);
      samples.push(sample('after-decorations', targetLine));
      resolve(samples);
    })
  `);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const initialScrollTop = result[0].scrollTop;
  const maxScrollDelta = Math.max(
    ...result.map(sample => Math.abs(sample.scrollTop - initialScrollTop))
  );
  const failed = maxScrollDelta > 1;
  if (failed) {
    process.stderr.write(`编辑器滚动位置变化了 ${maxScrollDelta}px\n`);
  }
  await window.close();
  app.exit(failed ? 1 : 0);
});
