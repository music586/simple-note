const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const {
  isMermaidDiagramStart,
  normalizePreviewMarkdown
} = require('../preview-markdown');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const packageJson = require('../package.json');

test('Mermaid diagrams are rendered offscreen with strict security and a theme cache', () => {
  assert.match(packageJson.dependencies.mermaid, /^\^11\./);
  assert.match(renderer, /require\.resolve\('mermaid'\)/);
  assert.match(
    renderer,
    /path\.join\(\s*path\.dirname\(mermaidModulePath\),\s*'mermaid\.min\.js'\s*\)/
  );
  assert.match(renderer, /document\.createElement\('script'\)/);
  assert.match(renderer, /resolve\(globalThis\.mermaid\)/);
  assert.doesNotMatch(renderer, /import\('mermaid'\)/);
  assert.doesNotMatch(renderer, /import\(mermaidModuleUrl\)/);
  assert.match(renderer, /securityLevel: 'strict'/);
  assert.match(renderer, /createHash\('sha256'\)/);
  assert.match(renderer, /const maxMermaidCacheEntries = 100/);
  assert.match(renderer, /pre > code\.language-mermaid/);
  assert.match(renderer, /const staging = document\.createElement\('div'\)/);
  assert.match(renderer, /previewRenderVersions\.get\(container\) !== renderVersion/);
  assert.match(renderer, /theme\n\s*}\);/);
});

test('Mermaid failures are isolated and keep the original source available', () => {
  assert.match(renderer, /'Mermaid 图表语法错误'/);
  assert.match(renderer, /'查看原始代码'/);
  assert.match(renderer, /createMermaidError\(source, error\)/);
  assert.match(styles, /\.mermaid-error\s*\{/);
  assert.match(styles, /\.mermaid-diagram svg\s*\{/);
});

test('Mermaid fences do not use the generic editable code widget', () => {
  assert.match(renderer, /function isMermaidCodeBlock\(block, documentLines\)/);
  assert.match(renderer, /if \(isMermaidCodeBlock\(block, documentLines\)\) \{/);
});

test('bare flowcharts are wrapped as Mermaid blocks for preview', () => {
  const source = [
    'flowchart TD',
    '    A[打开应用] --> B{是否已有笔记}',
    '    B -- 是 --> C[恢复上次编辑内容]'
  ].join('\n');
  const normalized = normalizePreviewMarkdown(source);

  assert.equal(normalized, `\`\`\`mermaid\n${source}\n\`\`\``);
  assert.match(marked.parse(normalized), /<code class="language-mermaid">/);
});

test('supported bare Mermaid diagram types are recognized', () => {
  const diagrams = [
    ['sequenceDiagram', 'Alice->>Bob: 你好'],
    ['stateDiagram-v2', '[*] --> Still'],
    ['classDiagram', 'Animal <|-- Duck'],
    ['gantt', 'title 项目计划'],
    ['pie title 宠物', '"狗" : 40'],
    ['journey', 'title 用户旅程']
  ];

  diagrams.forEach(([declaration, body]) => {
    const source = `${declaration}\n    ${body}`;
    const normalized = normalizePreviewMarkdown(source);
    assert.equal(isMermaidDiagramStart(declaration), true);
    assert.equal(normalized, `\`\`\`mermaid\n${source}\n\`\`\``);
  });
});

test('Mermaid is available in the code language picker', () => {
  assert.match(
    renderer,
    /label: 'Mermaid',[\s\S]*?language: 'mermaid',[\s\S]*?keywords: \['mermaid', '图表', '流程图'\]/
  );
});

test('Gantt diagrams use a readable horizontally scrollable canvas', () => {
  assert.match(renderer, /wrapper\.classList\.toggle\('is-gantt', isGanttDiagram\(source\)\)/);
  assert.match(styles, /\.cm-mermaid-widget\.is-gantt svg,[\s\S]*\.mermaid-diagram\.is-gantt svg/);
  assert.match(styles, /width: max\(100%, 2200px\)/);
  assert.match(styles, /max-width: none/);
});

test('Mermaid diagrams open in a true-size viewer', () => {
  assert.match(renderer, /function openMermaidViewer\(svg, source\)/);
  assert.match(
    renderer,
    /const previewContainer = svg\.closest\('\.cm-mermaid-widget, \.mermaid-diagram'\) \|\| svg/
  );
  assert.match(renderer, /const previewBounds = previewContainer\.getBoundingClientRect\(\)/);
  assert.match(renderer, /const viewBox = clonedSvg\.viewBox\.baseVal/);
  assert.match(renderer, /clonedSvg\.style\.width = `\$\{diagramWidth\}px`/);
  assert.match(renderer, /const viewerOuterGap = 48/);
  assert.match(renderer, /const viewerContentPadding = 64/);
  assert.match(renderer, /const minimumWidth = Math\.ceil\(previewBounds\.width\)/);
  assert.match(renderer, /const minimumHeight = Math\.ceil\(previewBounds\.height\)/);
  assert.match(renderer, /const trueSizeWidth = diagramWidth \+ viewerContentPadding/);
  assert.match(
    renderer,
    /const trueSizeHeight = diagramHeight \+ viewerContentPadding \+ viewerToolbarHeight/
  );
  assert.match(renderer, /Math\.max\(minimumWidth, trueSizeWidth\)/);
  assert.match(renderer, /Math\.max\(minimumHeight, trueSizeHeight\)/);
  assert.match(renderer, /mermaidViewerShell\.style\.width = `\$\{shellWidth\}px`/);
  assert.match(renderer, /mermaidViewerShell\.style\.height = `\$\{shellHeight\}px`/);
  assert.match(renderer, /function bindMermaidViewer\(wrapper, source, onEdit = null\)/);
  assert.match(renderer, /mermaidViewer\.classList\.add\('active'\)/);
  assert.match(renderer, /mermaidViewer\.tabIndex = -1/);
  assert.doesNotMatch(renderer, /mermaidViewer\.focus\(\)/);
  assert.match(renderer, /wrapper\.addEventListener\('mousedown', event =>/);
  assert.match(renderer, /if \(event\.button === 0\) event\.preventDefault\(\)/);
  assert.doesNotMatch(renderer, /mermaid-viewer-close/);
  assert.doesNotMatch(styles, /\.mermaid-viewer-close/);
  assert.match(styles, /\.mermaid-viewer-canvas\s*\{/);
  assert.match(styles, /overflow: auto/);
  assert.match(styles, /max-width: calc\(100vw - 48px\)/);
  assert.match(styles, /max-height: calc\(100vh - 48px\)/);
});

test('bare flowchart detection stops at blank lines and ignores existing fences', () => {
  const source = [
    'flowchart LR',
    'A --> B',
    '',
    '后续正文',
    '',
    '```text',
    'flowchart TD',
    'A --> B',
    '```'
  ].join('\n');

  assert.equal(normalizePreviewMarkdown(source), [
    '```mermaid',
    'flowchart LR',
    'A --> B',
    '```',
    '',
    '后续正文',
    '',
    '```text',
    'flowchart TD',
    'A --> B',
    '```'
  ].join('\n'));
});

test('unlabelled fences containing a flowchart are treated as Mermaid', () => {
  const source = [
    '```',
    'flowchart TD',
    '    A[打开应用] --> B{是否已有笔记}',
    '```'
  ].join('\n');

  assert.equal(normalizePreviewMarkdown(source), source.replace('```', '```mermaid'));
  assert.match(renderer, /isMermaidCodeBlock\(block, documentLines\)/);
});

test('Mermaid fences use a dedicated inline diagram widget in the editor', () => {
  assert.match(
    renderer,
    /function createEditorMermaidWidget\(source, theme, onEdit, onHeightChange\)/
  );
  assert.match(renderer, /widget\.className = 'cm-mermaid-widget'/);
  assert.match(renderer, /createEditorMermaidWidget\(\s*code,\s*colorTheme/);
  assert.match(renderer, /bindMermaidViewer\(widget, source, onEdit\)/);
  assert.match(renderer, /wrapper\.addEventListener\('dblclick', event =>/);
  assert.match(renderer, /widget\.title = 'Mermaid 图表，单击放大，双击编辑源码'/);
  assert.match(
    renderer,
    /if \(activeLine >= block\.start && activeLine <= block\.end\) return;/
  );
  assert.match(renderer, /preserveEditorScrollPosition\(codeMirror, \(\) =>/);
  assert.match(renderer, /codeMirror\.getInputField\(\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(renderer, /requestAnimationFrame\(restorePageScroll\)/);
  assert.match(renderer, /widget\.innerHTML = svg;[\s\S]*?onHeightChange\(\)/);
  assert.match(styles, /\.cm-mermaid-widget\s*\{/);
});

test('explicit non-Mermaid fence languages are not overridden by flowchart-like content', () => {
  const source = '```css\nflowchart TD\nA --> B\n```';

  assert.equal(normalizePreviewMarkdown(source), source);
});
