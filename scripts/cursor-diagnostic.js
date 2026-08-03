const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 950,
    height: 500,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  app.focus({ steal: true });
  window.focus();
  window.webContents.focus();
  const measurements = await window.webContents.executeJavaScript(`
    (async () => {
      const cm = document.querySelector('#leftPanel .cm-editor').simpleNoteEditor;
      const { getEditorCursorAlignment } = require('./editor-cursor');
      cm.focus();
      await new Promise(next => requestAnimationFrame(() => requestAnimationFrame(next)));
      const results = [];
      for (let level = 1; level <= 6; level += 1) {
        cm.setValue('\\n'.repeat(level - 1) + '#'.repeat(level) + ' 标题');
        cm.setCursor({ line: level - 1, ch: level + 3 });
        const decorations = [
          cm.addLineDecoration(level - 1, 'wrap', 'cm-rendered-heading-line'),
          cm.addLineDecoration(level - 1, 'wrap', 'cm-rendered-heading-line-' + level),
          cm.addMarkDecoration(
          { line: level - 1, ch: 0 },
          { line: level - 1, ch: level + 3 },
          { className: 'cm-editing-source-line cm-editing-heading cm-rendered-h' + level }
          )
        ];
        cm.refresh();
        const wrapper = cm.getWrapperElement();
        wrapper.style.removeProperty('--editor-cursor-height');
        wrapper.style.removeProperty('--editor-cursor-offset');
        const baseCursor = document.querySelector('#leftPanel .cm-cursor')
          .getBoundingClientRect();
        const baseText = document.querySelector('#leftPanel .cm-editing-heading')
          .getBoundingClientRect();
        const alignment = getEditorCursorAlignment(baseCursor, baseText);
        wrapper.style.setProperty('--editor-cursor-height', alignment.height + 'px');
        wrapper.style.setProperty('--editor-cursor-offset', alignment.offset + 'px');
        await new Promise(next => requestAnimationFrame(() => requestAnimationFrame(next)));
        const cursor = document.querySelector('#leftPanel .cm-cursor')
          .getBoundingClientRect();
        const cursorElement = document.querySelector('#leftPanel .cm-cursor');
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
        decorations.forEach(decoration => (decoration.handle || decoration).clear());
      }
      for (const sample of [
        { name: 'plain', value: '普通文本', mark: true },
        { name: 'empty', value: '', mark: false }
      ]) {
        cm.setValue(sample.value);
        cm.setCursor({ line: 0, ch: sample.value.length });
        if (sample.mark) {
          cm.addMarkDecoration(
            { line: 0, ch: 0 },
            { line: 0, ch: sample.value.length },
            { className: 'cm-editing-source-line' }
          );
        }
        cm.refresh();
        const wrapper = cm.getWrapperElement();
        wrapper.style.removeProperty('--editor-cursor-height');
        wrapper.style.removeProperty('--editor-cursor-offset');
        const cursorElement = document.querySelector('#leftPanel .cm-cursor');
        const baseCursor = cursorElement.getBoundingClientRect();
        const activeText = wrapper.querySelector('.cm-editing-source-line');
        const textRect = activeText?.getBoundingClientRect() || {
          top: baseCursor.top + (baseCursor.height - 22.4) / 2,
          height: 22.4
        };
        const alignment = getEditorCursorAlignment(baseCursor, textRect);
        wrapper.style.setProperty('--editor-cursor-height', alignment.height + 'px');
        wrapper.style.setProperty('--editor-cursor-offset', alignment.offset + 'px');
        await new Promise(next => requestAnimationFrame(() => requestAnimationFrame(next)));
        const cursor = cursorElement.getBoundingClientRect();
        results.push({
          level: sample.name,
          cursor: { top: cursor.top, bottom: cursor.bottom, height: cursor.height },
          text: { top: textRect.top, bottom: textRect.top + textRect.height, height: textRect.height },
          centerDelta: cursor.top + cursor.height / 2 - textRect.top - textRect.height / 2
        });
      }
      return results;
    })()
  `);

  process.stdout.write(`${JSON.stringify(measurements)}\n`);
  await window.close();
  app.quit();
});
