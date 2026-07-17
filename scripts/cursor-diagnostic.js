const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 950,
    height: 500,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const measurements = await window.webContents.executeJavaScript(`
    new Promise(async resolve => {
      const cm = document.querySelector('#leftPanel .CodeMirror').CodeMirror;
      const { getEditorCursorAlignment } = require('./editor-cursor');
      cm.focus();
      const results = [];
      for (let level = 1; level <= 6; level += 1) {
        cm.setValue('\\n'.repeat(level - 1) + '#'.repeat(level) + ' 标题');
        cm.setCursor({ line: level - 1, ch: level + 3 });
        cm.addLineClass(level - 1, 'wrap', 'cm-rendered-heading-line');
        cm.addLineClass(level - 1, 'wrap', 'cm-rendered-heading-line-' + level);
        cm.markText(
          { line: level - 1, ch: 0 },
          { line: level - 1, ch: level + 3 },
          { className: 'cm-editing-source-line cm-editing-heading cm-rendered-h' + level }
        );
        cm.refresh();
        const wrapper = cm.getWrapperElement();
        wrapper.style.removeProperty('--editor-cursor-height');
        wrapper.style.removeProperty('--editor-cursor-offset');
        const baseCursor = document.querySelector('#leftPanel .CodeMirror-cursor')
          .getBoundingClientRect();
        const baseText = document.querySelector('#leftPanel .cm-editing-heading')
          .getBoundingClientRect();
        const alignment = getEditorCursorAlignment(baseCursor, baseText);
        wrapper.style.setProperty('--editor-cursor-height', alignment.height + 'px');
        wrapper.style.setProperty('--editor-cursor-offset', alignment.offset + 'px');
        await new Promise(next => requestAnimationFrame(() => requestAnimationFrame(next)));
        const cursor = document.querySelector('#leftPanel .CodeMirror-cursor')
          .getBoundingClientRect();
        const cursorElement = document.querySelector('#leftPanel .CodeMirror-cursor');
        const text = document.querySelector('#leftPanel .cm-editing-heading')
          .getBoundingClientRect();
        const computedCursor = getComputedStyle(cursorElement);
        results.push({
          level,
          cursorInlineStyle: cursorElement.getAttribute('style'),
          computedHeight: computedCursor.height,
          computedTransform: computedCursor.transform,
          alignment,
          cursor: { top: cursor.top, bottom: cursor.bottom, height: cursor.height },
          text: { top: text.top, bottom: text.bottom, height: text.height },
          cursorCenter: (cursor.top + cursor.bottom) / 2,
          textCenter: (text.top + text.bottom) / 2,
          centerDelta: (cursor.top + cursor.bottom - text.top - text.bottom) / 2
        });
      }
      resolve(results);
    })
  `);

  process.stdout.write(`${JSON.stringify(measurements)}\n`);
  await window.close();
  app.quit();
});
