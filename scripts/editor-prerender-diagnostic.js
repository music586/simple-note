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
        '普通 **粗体** 与 <strong>HTML 粗体</strong>、<u>下划线</u>、H<sub>2</sub>O *斜体* ~~删除~~ ==高亮== 和 \`代码\`。',
        '',
        '[相对链接](./other.md) 与 [外部链接](https://example.com)',
        '<a href="./other.md">HTML 相对链接</a>',
        '<div>',
        '  <div><strong>HTML 容器</strong></div>',
        '</div>',
        '',
        '<p>HTML 段落</p>',
        '',
        '<img src="missing.png" alt="HTML 图片" onerror="window.previewSecurityTriggered = true">',
        '',
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
        '诊断结束',
        '[活动相对链接](./other.md)'
      ].join('\\n');
      currentNote = { path: ${JSON.stringify(path.join(__dirname, '..', 'diagnostic.md'))} };
      window.previewSecurityTriggered = false;
      editor.value = source;
      editor.setCursorIndex(source.length);
      previewHiddenLeft = false;
      updatePreview(true);
      await waitFrames(8);
      const codeMirror = editor.codeMirror;
      const root = codeMirror.getWrapperElement();
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
        htmlInline: count('.cm-rendered-html-inline'),
        htmlBlocks: count('.cm-rendered-html-block'),
        htmlBlockImages: count('.cm-rendered-html-block img'),
        htmlBlockContentWidth: root.querySelector('.cm-rendered-html-block')
          ?.firstElementChild?.getBoundingClientRect().width || 0,
        htmlBlockEditorWidth: root.getBoundingClientRect().width,
        htmlStrongWeights: Array.from(root.querySelectorAll(
          '.cm-rendered-html-inline strong, .cm-rendered-html-block strong'
        )).map(element => Number.parseInt(getComputedStyle(element).fontWeight, 10)),
        previewFrontMatter: preview.querySelectorAll('.preview-frontmatter').length,
        previewMath: preview.querySelectorAll('.katex').length,
        previewCallouts: preview.querySelectorAll('.callout').length,
        previewWikiLinks: preview.querySelectorAll('.wiki-link').length,
        previewScripts: preview.querySelectorAll('script').length,
        previewEventAttributes: preview.querySelectorAll('[onerror], [onclick], [onload]').length,
        previewSecurityTriggered: window.previewSecurityTriggered
      };

      codeMirror.scrollTo(null, codeMirror.getScrollInfo().height);
      await waitFrames(3);
      const firstOutlineItem = documentOutline.querySelector('.document-outline-item');
      firstOutlineItem?.click();
      await waitFrames(6);
      const outlineTargetLine = Number(firstOutlineItem?.dataset.line ?? -1);
      result.firstOutlineClick = {
        targetLine: outlineTargetLine,
        cursorLine: codeMirror.getCursor().line,
        scrollDelta: outlineTargetLine >= 0
          ? Math.abs(
            codeMirror.getScrollInfo().top
              - codeMirror.heightAtLine(outlineTargetLine, 'local')
          )
          : Number.POSITIVE_INFINITY
      };

      const htmlLinkPreview = root.querySelector('.cm-rendered-html-inline .cm-rendered-link');
      htmlLinkPreview?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0
      }));
      await waitFrames(3);
      result.htmlLinkFocusRestoresSource = codeMirror.getCursor().line === 10
        && codeMirror.getLine(10).startsWith('<a href=');
      documentOutline.querySelector('.document-outline-item')?.focus();
      await waitFrames(4);

      const htmlBlock = root.querySelector('.cm-rendered-html-block');
      const htmlBlockText = htmlBlock?.querySelector('strong');
      const htmlBlockTextRect = htmlBlockText?.getBoundingClientRect();
      htmlBlock?.firstElementChild?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: htmlBlockTextRect ? htmlBlockTextRect.left + 2 : 0,
        clientY: htmlBlockTextRect ? htmlBlockTextRect.top + htmlBlockTextRect.height / 2 : 0
      }));
      await waitFrames(3);
      result.htmlFocusRestoresSource = codeMirror.getCursor().line === 11
        && codeMirror.getLine(11) === '<div>';
      documentOutline.querySelector('.document-outline-item')?.focus();
      await waitFrames(4);
      result.htmlBlurRestoresPreview = root.querySelectorAll('.cm-rendered-html-block').length === 4;
      const restoredHtmlBlock = root.querySelector('.cm-rendered-html-block');
      const restoredRect = restoredHtmlBlock?.getBoundingClientRect();
      const cursorBeforeBlankClick = codeMirror.getCursor().line;
      const blankClientX = restoredRect ? restoredRect.right - 1 : 0;
      const blankClientY = restoredRect ? restoredRect.bottom - 1 : 0;
      const blankHit = restoredHtmlBlock
        ? isHtmlPreviewContentHit(restoredHtmlBlock, blankClientX, blankClientY)
        : true;
      restoredHtmlBlock?.firstElementChild?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: blankClientX,
        clientY: blankClientY
      }));
      await waitFrames(2);
      result.htmlBlankArea = {
        hit: blankHit,
        cursorBefore: cursorBeforeBlankClick,
        cursorAfter: codeMirror.getCursor().line,
        blocksAfter: root.querySelectorAll('.cm-rendered-html-block').length
      };
      result.htmlBlankAreaIgnored = !blankHit
        && result.htmlBlankArea.blocksAfter === 4;

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
    && result.strong >= 2
    && result.emphasis >= 1
    && result.strike >= 1
    && result.highlight >= 1
    && result.inlineCode >= 1
    && result.links === 5
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
    && result.htmlInline === 4
    && result.htmlBlocks === 4
    && result.htmlBlockImages === 2
    && result.htmlBlockContentWidth > 0
    && result.htmlBlockContentWidth < result.htmlBlockEditorWidth * 0.9
    && result.htmlStrongWeights.length === 2
    && result.htmlStrongWeights.every(weight => weight >= 700)
    && result.previewFrontMatter === 1
    && result.previewMath >= 2
    && result.previewCallouts === 1
    && result.previewWikiLinks === 1
    && result.previewScripts === 0
    && result.previewEventAttributes === 0
    && !result.previewSecurityTriggered
    && result.firstOutlineClick.targetLine >= 0
    && result.firstOutlineClick.cursorLine === result.firstOutlineClick.targetLine
    && result.firstOutlineClick.scrollDelta <= 1
    && result.htmlFocusRestoresSource
    && result.htmlLinkFocusRestoresSource
    && result.htmlBlurRestoresPreview
    && result.htmlBlankAreaIgnored
    && result.tableLineBreakSaved
    && result.tableLineBreakRendered;
  await window.close();
  app.exit(passed ? 0 : 1);
});
