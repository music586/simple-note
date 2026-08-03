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
      const source = ${JSON.stringify(source)};
      const waitForDecorations = () => new Promise(resolve => {
        setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 140);
      });
      const errors = [];
      window.addEventListener('error', event => errors.push(event.message));
      window.addEventListener('unhandledrejection', event => {
        errors.push(String(event.reason?.message || event.reason));
      });

      currentNote = { path: ${JSON.stringify(documentPath)} };
      editor.value = source;
      editor.setCursorIndex(source.length);
      updatePreview(true);
      await waitForDecorations();

      const codeMirror = editor.codeMirror;
      const root = codeMirror.getWrapperElement();
      const selectors = {
        headings: '.cm-rendered-heading',
        strong: '.cm-rendered-strong',
        emphasis: '.cm-rendered-em',
        strike: '.cm-rendered-strike',
        highlight: '.cm-rendered-highlight',
        inlineCode: '.cm-rendered-code',
        links: '.cm-rendered-link',
        quotes: '.cm-rendered-quote',
        lists: '.cm-rendered-list-line',
        tasks: '.cm-rendered-checkbox',
        rules: '.cm-rendered-rule',
        tables: '.cm-table-widget',
        codeBlocks: '.cm-code-widget',
        mermaid: '.cm-mermaid-widget',
        frontMatter: '.cm-frontmatter-widget',
        math: '.cm-math-widget',
        callouts: '.cm-callout-widget',
        wikiLinks: '.cm-rendered-link.is-wiki-link',
        richInline: '.cm-rich-inline-widget'
      };
      const maximums = Object.fromEntries(Object.keys(selectors).map(key => [key, 0]));
      const observedNearLines = Object.fromEntries(Object.keys(selectors).map(key => [key, []]));

      for (let line = 0; line < codeMirror.lineCount(); line += 60) {
        codeMirror.scrollTo(null, codeMirror.heightAtLine(line, 'local'));
        await waitForDecorations();
        for (const [key, selector] of Object.entries(selectors)) {
          const count = root.querySelectorAll(selector).length;
          maximums[key] = Math.max(maximums[key], count);
          if (count && observedNearLines[key].length < 4) observedNearLines[key].push(line + 1);
        }
      }

      const lines = source.split('\\n');
      const tableLine = Math.max(0, lines.findIndex(line => line.includes('| 功能 | 说明')));
      codeMirror.scrollTo(null, codeMirror.heightAtLine(tableLine, 'local'));
      await waitForDecorations();
      const tables = Array.from(root.querySelectorAll('.cm-table-widget'));
      const table = tables.find(candidate => candidate.innerText.includes('支持标题搜索'));
      const multilineCell = Array.from(table?.querySelectorAll('td') || [])
        .find(cell => cell.innerText.includes('支持标题搜索'));
      const delimiterCells = (lines[tableLine + 1] || '')
        .trim()
        .replace(/^\\||\\|$/g, '')
        .split('|')
        .map(cell => cell.trim());
      const standardDelimiter = delimiterCells.length > 0
        && delimiterCells.every(cell => /^:?-{3,}:?$/.test(cell));

      return {
        path: ${JSON.stringify(documentPath)},
        lines: codeMirror.lineCount(),
        valueMatches: editor.value === source,
        maximums,
        observedNearLines,
        tableAudit: {
          sourceLine: tableLine + 1,
          delimiterLine: tableLine + 2,
          standardDelimiter,
          rendered: Boolean(table),
          rawMarkdownVisible: root.innerText.includes('| 功能 | 说明'),
          multilineCell: multilineCell?.innerText || null,
          lineBreakCount: multilineCell ? multilineCell.innerText.split('\\n').length - 1 : 0
        },
        errors
      };
    })()
  `);

  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync('/private/tmp/simple-note-document-prerender-audit.png', screenshot.toPNG());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const required = [
    'headings',
    'strong',
    'emphasis',
    'strike',
    'inlineCode',
    'links',
    'quotes',
    'lists',
    'tasks',
    'rules',
    'tables',
    'codeBlocks',
    'mermaid',
    'math',
    'callouts',
    'wikiLinks',
    'richInline'
  ];
  const passed = result.valueMatches
    && result.errors.length === 0
    && required.every(key => result.maximums[key] > 0)
    && (result.tableAudit.standardDelimiter
      ? result.tableAudit.rendered
        && !result.tableAudit.rawMarkdownVisible
        && result.tableAudit.lineBreakCount === 2
      : !result.tableAudit.rendered && result.tableAudit.rawMarkdownVisible);
  await window.close();
  app.exit(passed ? 0 : 1);
});
