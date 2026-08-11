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
            columnWidths: Array.from(tableElement.rows[0]?.cells || []).map(cell => (
              Math.round(cell.getBoundingClientRect().width)
            )),
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
      const markdownTableSource = [
        '| 样式 | 链接 |',
        '| --- | --- |',
        '| **粗体**、*斜体*、~~删除~~、==高亮==、\`代码\`、<b>HTML粗体</b>、<u>下划线</u>、H<sub>2</sub>O | <a href="./other.md">HTML笔记</a> |'
      ].join('\\n');
      editor.value = markdownTableSource;
      editor.setCursorIndex(markdownTableSource.length);
      updatePreview(true);
      await wait();
      const markdownWidget = root.querySelector('.cm-table-widget');
      const markdownCell = markdownWidget?.querySelector('tbody td');
      const markdownLink = markdownWidget?.querySelector('tbody td:nth-child(2) .cm-rendered-link');
      const markdownPreview = {
        strong: markdownCell?.querySelectorAll('strong').length || 0,
        emphasis: markdownCell?.querySelectorAll('em').length || 0,
        strike: markdownCell?.querySelectorAll('del').length || 0,
        highlight: markdownCell?.querySelectorAll('mark').length || 0,
        code: markdownCell?.querySelectorAll('code').length || 0,
        htmlBold: markdownCell?.querySelectorAll('b').length || 0,
        underline: markdownCell?.querySelectorAll('u').length || 0,
        subscript: markdownCell?.querySelectorAll('sub').length || 0,
        links: markdownLink ? 1 : 0,
        sourceBeforeFocus: markdownCell?.dataset.markdownSource || ''
      };
      focusEditableAtStart(markdownCell);
      markdownPreview.editingSource = markdownCell?.textContent || '';
      markdownCell?.dispatchEvent(new FocusEvent('blur'));
      markdownPreview.renderedAfterBlur = markdownCell?.querySelectorAll('strong').length || 0;
      codeMirror.focus();
      await wait();
      const emptyRowSource = [
        '| 第一列 | 第二列 |',
        '| --- | --- |',
        '|  |  |'
      ].join('\\n');
      editor.value = emptyRowSource;
      editor.setCursorIndex(emptyRowSource.length);
      updatePreview(true);
      await wait();
      const initialWidget = root.querySelector('.cm-table-widget');
      const emptyCell = initialWidget?.querySelector('tbody td');
      emptyCell?.focus();
      const selectionMouseDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0
      });
      emptyCell?.dispatchEvent(selectionMouseDown);
      const pasteData = new DataTransfer();
      pasteData.setData('text/plain', '刚输入的内容');
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: pasteData
      });
      emptyCell?.dispatchEvent(pasteEvent);
      if (emptyCell && !pasteEvent.defaultPrevented) {
        emptyCell.textContent = pasteData.getData('text/plain');
      }
      initialWidget?.querySelector('.cm-table-add-column')?.dispatchEvent(new MouseEvent(
        'mousedown',
        { bubbles: true, button: 0 }
      ));
      await wait();
      const updatedWidget = root.querySelector('.cm-table-widget');
      const emptyRowColumnAdd = {
        source: editor.value,
        rows: updatedWidget?.querySelector('table')?.rows.length || 0,
        columns: updatedWidget?.querySelector('table')?.rows[0]?.cells.length || 0,
        emptyRowColumns: updatedWidget?.querySelector('table')?.rows[1]?.cells.length || 0,
        emptyColumnWidths: Array.from(
          updatedWidget?.querySelector('table')?.rows[1]?.cells || []
        ).filter(cell => !cell.textContent).map(cell => Math.round(cell.getBoundingClientRect().width))
      };
      const headerCell = updatedWidget?.querySelector('thead th:nth-child(2)');
      headerCell?.focus();
      headerCell?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      const existingRowCell = document.activeElement?.closest?.('th, td');
      const existingRowNavigation = {
        activeRow: existingRowCell?.parentElement?.rowIndex ?? -1,
        activeColumn: existingRowCell?.cellIndex ?? -1
      };
      const lastCell = updatedWidget?.querySelector('tbody tr:last-child td:nth-child(2)');
      lastCell?.focus();
      lastCell?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      await wait();
      const enterWidget = root.querySelector('.cm-table-widget');
      const enterTable = enterWidget?.querySelector('table');
      const activeCell = document.activeElement?.closest?.('th, td');
      const enterNavigation = {
        rows: enterTable?.rows.length || 0,
        activeRow: activeCell?.parentElement?.rowIndex ?? -1,
        activeColumn: activeCell?.cellIndex ?? -1
      };
      return {
        lines: codeMirror.lineCount(),
        samples,
        mouseSelectionBlocked: selectionMouseDown.defaultPrevented,
        pasteDefaultPrevented: pasteEvent.defaultPrevented,
        emptyRowColumnAdd,
        existingRowNavigation,
        enterNavigation,
        markdownPreview,
        errors
      };
    })()
  `);
  result.controlPreview = await window.webContents.executeJavaScript(`
    (async () => {
      await new Promise(resolve => setTimeout(resolve, 180));
      const widget = editor.codeMirror.getWrapperElement().querySelector('.cm-table-widget');
      widget?.classList.add('show-add-column', 'show-add-row');
      await new Promise(resolve => setTimeout(resolve, 240));
      const columnButton = widget?.querySelector('.cm-table-add-column');
      const rowButton = widget?.querySelector('.cm-table-add-row');
      const rowContent = widget?.querySelector('.cm-table-add-row-content');
      const rowIcon = rowContent?.querySelector('.cm-table-add-icon');
      const rowLabel = rowContent?.querySelector('.cm-table-add-label');
      const getTextVisualMetrics = element => {
        if (!element) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = style.font;
        const metrics = context.measureText(element.textContent);
        const fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
        const lineHeight = Number.parseFloat(style.lineHeight);
        const baseline = rect.top
          + (lineHeight - fontHeight) / 2
          + metrics.fontBoundingBoxAscent;
        return {
          boxCenter: rect.top + rect.height / 2,
          inkCenter: baseline
            + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2,
          font: style.font
        };
      };
      const widgetRect = widget?.getBoundingClientRect();
      const viewportRect = widget?.querySelector('.cm-table-viewport')?.getBoundingClientRect();
      const rowButtonRect = rowButton?.getBoundingClientRect();
      const rowIconMetrics = getTextVisualMetrics(rowIcon);
      const rowLabelMetrics = getTextVisualMetrics(rowLabel);
      return {
        className: widget?.className || '',
        columnOpacity: columnButton ? getComputedStyle(columnButton).opacity : '',
        rowOpacity: rowButton ? getComputedStyle(rowButton).opacity : '',
        rowStartsAfterViewport: Boolean(
          viewportRect && rowButtonRect && rowButtonRect.top >= viewportRect.bottom - 0.5
        ),
        rowIcon: rowIconMetrics,
        rowLabel: rowLabelMetrics,
        rowVisualCenterDelta: rowIconMetrics && rowLabelMetrics
          ? Math.abs(rowIconMetrics.inkCenter - rowLabelMetrics.inkCenter)
          : null,
        captureBounds: widgetRect ? {
          x: Math.max(0, Math.floor(widgetRect.left - 36)),
          y: Math.max(0, Math.floor(widgetRect.top - 24)),
          width: Math.ceil(widgetRect.width + 72),
          height: Math.ceil(widgetRect.height + 60)
        } : null
      };
    })()
  `);
  const screenshot = await window.webContents.capturePage(result.controlPreview.captureBounds);
  fs.writeFileSync('/private/tmp/simple-note-table-document.png', screenshot.toPNG());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await window.close();
  const emptyRowPassed = result.emptyRowColumnAdd.rows === 2
    && result.emptyRowColumnAdd.columns === 3
    && result.emptyRowColumnAdd.emptyRowColumns === 3
    && result.emptyRowColumnAdd.emptyColumnWidths.every(width => width >= 50)
    && result.emptyRowColumnAdd.source === [
      '| 第一列 | 第二列 |  |',
      '| --- | --- | --- |',
      '| 刚输入的内容 |  |  |'
    ].join('\n');
  const rowCenterPassed = result.controlPreview.rowVisualCenterDelta !== null
    && result.controlPreview.rowVisualCenterDelta <= 0.25;
  const enterPassed = result.enterNavigation.rows === 3
    && result.enterNavigation.activeRow === 2
    && result.enterNavigation.activeColumn === 1
    && result.existingRowNavigation.activeRow === 1
    && result.existingRowNavigation.activeColumn === 1;
  const markdownPreviewPassed = result.markdownPreview.strong === 1
    && result.markdownPreview.emphasis === 1
    && result.markdownPreview.strike === 1
    && result.markdownPreview.highlight === 1
    && result.markdownPreview.code === 1
    && result.markdownPreview.htmlBold === 1
    && result.markdownPreview.underline === 1
    && result.markdownPreview.subscript === 1
    && result.markdownPreview.links === 1
    && result.markdownPreview.sourceBeforeFocus.includes('**粗体**')
    && result.markdownPreview.editingSource.includes('**粗体**')
    && result.markdownPreview.renderedAfterBlur === 1;
  app.exit(
    result.errors.length || result.mouseSelectionBlocked || result.pasteDefaultPrevented
      || !emptyRowPassed || !enterPassed || !markdownPreviewPassed
      || !result.controlPreview.rowStartsAfterViewport || !rowCenterPassed
      ? 1
      : 0
  );
});
