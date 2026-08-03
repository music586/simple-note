const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({ path: '', alias: '', name: '' }));
  ipcMain.handle('get-ai-settings', () => ({ apiKey: '', model: '' }));

  const window = new BrowserWindow({
    width: 1500,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const waitFrames = count => new Promise(resolve => {
        const next = () => count-- > 0 ? requestAnimationFrame(next) : resolve();
        requestAnimationFrame(next);
      });
      const source = [
        '---',
        'title: 预渲染诊断',
        'tags: markdown',
        '---',
        '',
        '# 一级标题',
        '',
        '普通 **粗体** *斜体* ~~删除~~ ==高亮== 和 \`代码\`。',
        '',
        '[相对链接](./other.md) 与 [外部链接](https://example.com)',
        '[[内部笔记|Wiki 链接]] 与 ***粗斜体***',
        '行内公式 $E = mc^2$',
        '<img src="missing.png" onerror="window.previewSecurityTriggered = true">',
        '<script>window.previewSecurityTriggered = true</script>',
        '',
        '$$',
        'A = \\pi r^2',
        '$$',
        '',
        '> 引用内容',
        '',
        '> [!WARNING] 注意事项',
        '> 保存前请检查内容。',
        '',
        '- 无序列表',
        '1. 有序列表',
        '- [ ] 未完成任务',
        '',
        '---',
        '',
        '| 姓名 | 状态 |',
        '| --- | --- |',
        '| 测试 | 正常 |',
        '',
        '\`\`\`javascript',
        'const answer = 42;',
        '\`\`\`',
        '',
        '诊断结束'
      ].join('\\n');
      currentNote = { path: ${JSON.stringify(path.join(__dirname, '..', 'diagnostic.md'))} };
      window.previewSecurityTriggered = false;
      editor.value = source;
      editor.setCursorIndex(source.length);
      previewHiddenLeft = false;
      updatePreview(true);
      await waitFrames(8);
      const root = editor.codeMirror.getWrapperElement();
      const count = selector => root.querySelectorAll(selector).length;
      const result = {
        valueMatches: editor.value === source,
        heading: count('.cm-rendered-heading'),
        strong: count('.cm-rendered-strong'),
        emphasis: count('.cm-rendered-em'),
        strike: count('.cm-rendered-strike'),
        highlight: count('.cm-rendered-highlight'),
        inlineCode: count('.cm-rendered-code'),
        links: count('.cm-rendered-link'),
        quotes: count('.cm-rendered-quote'),
        lists: count('.cm-rendered-list-line'),
        tasks: count('.cm-rendered-checkbox'),
        rules: count('.cm-rendered-rule'),
        tables: count('.cm-table-widget'),
        codeBlocks: count('.cm-code-widget'),
        frontMatter: count('.cm-frontmatter-widget'),
        math: count('.cm-math-widget'),
        callouts: count('.cm-callout-widget'),
        wikiLinks: count('.cm-rendered-link.is-wiki-link'),
        richInline: count('.cm-rich-inline-widget'),
        previewFrontMatter: preview.querySelectorAll('.preview-frontmatter').length,
        previewMath: preview.querySelectorAll('.katex').length,
        previewCallouts: preview.querySelectorAll('.callout').length,
        previewWikiLinks: preview.querySelectorAll('.wiki-link').length,
        previewScripts: preview.querySelectorAll('script').length,
        previewEventAttributes: preview.querySelectorAll('[onerror], [onclick], [onload]').length,
        previewSecurityTriggered: window.previewSecurityTriggered
      };

      const tableCell = root.querySelector('.cm-table-widget tbody td');
      const selection = window.getSelection();
      const range = document.createRange();
      tableCell.focus();
      range.selectNodeContents(tableCell);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      tableCell.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      const textRange = selection.getRangeAt(0);
      const secondLine = document.createTextNode('第二行');
      textRange.insertNode(secondLine);
      textRange.setStartAfter(secondLine);
      textRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(textRange);
      tableCell.blur();
      tableCell.dispatchEvent(new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: editor.codeMirror.getInputField()
      }));
      await waitFrames(8);
      result.tableSource = editor.value.split('\\n').find(line => line.includes('<br>')) || '';
      result.tableLineBreakSaved = editor.value.includes('测试<br>第二行');
      result.tableLineBreakRendered = root.querySelector('.cm-table-widget tbody td')
        ?.innerText.includes('测试\\n第二行') || false;
      return result;
    })()
  `);

  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync('/private/tmp/simple-note-editor-prerender.png', screenshot.toPNG());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const passed = result.valueMatches
    && result.heading === 1
    && result.strong >= 1
    && result.emphasis >= 1
    && result.strike >= 1
    && result.highlight >= 1
    && result.inlineCode >= 1
    && result.links === 3
    && result.quotes >= 1
    && result.lists >= 3
    && result.tasks === 1
    && result.rules === 1
    && result.tables === 1
    && result.codeBlocks === 1
    && result.frontMatter === 1
    && result.math === 2
    && result.callouts === 1
    && result.wikiLinks === 1
    && result.richInline >= 1
    && result.previewFrontMatter === 1
    && result.previewMath >= 2
    && result.previewCallouts === 1
    && result.previewWikiLinks === 1
    && result.previewScripts === 0
    && result.previewEventAttributes === 0
    && !result.previewSecurityTriggered
    && result.tableLineBreakSaved
    && result.tableLineBreakRendered;
  await window.close();
  app.exit(passed ? 0 : 1);
});
