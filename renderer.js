const path = require('path');
const { pathToFileURL } = require('url');
const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');
const CodeMirror = require('codemirror');
require('codemirror/mode/markdown/markdown');
const {
  getEditorCursorAlignment,
  getFallbackTextRect,
  getCurrentLineTextRect
} = require('./editor-cursor');
const {
  applyCodeMirrorEdit,
  createMarkdownKeyHandlers
} = require('./markdown-keymap');
const {
  clearSlashCommandAccessibility,
  getNextSlashCommandIndex,
  getSlashCommandMenuLayout,
  setSlashCommandAccessibility
} = require('./slash-command-ui');
const { getTableAddControlState } = require('./table-ui');
const { getTaskCheckboxEdit } = require('./preview-task');
const { getMarkdownFormatEdit } = require('./markdown-format');
const { normalizePreviewMarkdown } = require('./preview-markdown');
const {
  scheduleDecorationHeightChange
} = require('./editor-widget-height');
const {
  findEditorMatches,
  getClosestEditorMatchIndex,
  getNextEditorMatchIndex
} = require('./editor-find');
const {
  normalizeClipboardText,
  joinClipboardTextAndImages,
  removeGeneratedBoundaryNewlines,
  shouldConvertClipboardHtml,
  applyClipboardMarkdownMarks,
  optimizeClipboardPlainText
} = require('./clipboard-format');
const {
  filterStructureCommands,
  analyzeLineContext,
  getRenderedListPrefix,
  shouldRenderActiveListPrefix,
  getActiveBulletSourceCursor,
  getHeadingSectionRange,
  getDocumentOutline,
  getFencedCodeBlocks,
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit,
  getSlashMenuUpdate,
  getSlashCommandEdit
} = require('./markdown-structure');

marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

marked.use({
  extensions: [{
    name: 'highlight',
    level: 'inline',
    start(source) {
      return source.indexOf('==');
    },
    tokenizer(source) {
      const match = source.match(/^==([^=\n]+)==/);
      if (!match) return undefined;
      return {
        type: 'highlight',
        raw: match[0],
        tokens: this.lexer.inlineTokens(match[1])
      };
    },
    renderer(token) {
      return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
    }
  }]
});

let currentNote = null;
let currentNoteRight = null;
let tree = [];
let expandedFolders = new Set();
let contextMenuData = null;
let draggedItem = null;
let tableContextActionHandler = null;
let pendingTableFocusEditor = null;
let pendingCodeFocusEditor = null;
let pendingCodeFenceCompletion = null;
let workspaceSessionRestored = false;
let restoringWorkspaceSession = false;
let openReleaseNotesVersion = null;
const workspaceSessionKey = 'workspace-session';

const notesList = document.getElementById('notesList');
const slashCommandMenuElement = document.getElementById('slashCommandMenu');
const codeLanguagePicker = document.getElementById('codeLanguagePicker');
const codeLanguageSearch = document.getElementById('codeLanguageSearch');
const codeLanguageResults = document.getElementById('codeLanguageResults');
const slashCommandState = {
  editor: null,
  query: '',
  commands: [],
  selectedIndex: 0,
  composing: false
};
const codeLanguages = [
  { label: '纯文本', language: '', keywords: ['纯文本', 'text', 'plain', 'txt'] },
  { label: 'JavaScript', language: 'javascript', keywords: ['javascript', 'js'] },
  { label: 'TypeScript', language: 'typescript', keywords: ['typescript', 'ts'] },
  { label: 'Python', language: 'python', keywords: ['python', 'py'] },
  { label: 'JSON', language: 'json', keywords: ['json'] },
  { label: 'YAML', language: 'yaml', keywords: ['yaml', 'yml'] },
  { label: 'HTML / XML', language: 'html', keywords: ['html', 'xml'] },
  { label: 'CSS', language: 'css', keywords: ['css'] },
  { label: 'SQL', language: 'sql', keywords: ['sql'] },
  { label: 'Shell / Bash', language: 'bash', keywords: ['shell', 'bash', 'sh', 'zsh'] },
  { label: 'Java', language: 'java', keywords: ['java'] },
  { label: 'C', language: 'c', keywords: ['c'] },
  { label: 'C++', language: 'cpp', keywords: ['c++', 'cpp'] },
  { label: 'Go', language: 'go', keywords: ['go', 'golang'] },
  { label: 'Rust', language: 'rust', keywords: ['rust', 'rs'] },
  { label: 'Swift', language: 'swift', keywords: ['swift'] }
];
const codeLanguageState = {
  languages: codeLanguages,
  selectedIndex: 0
};
let lastActiveEditor = null;
const editor = createCodeEditor(document.getElementById('editor'));
const preview = document.getElementById('preview');
const noteTitle = document.getElementById('noteTitle');
const settingsBtn = document.getElementById('settingsBtn');
const notesDirInfo = document.getElementById('notesDirInfo');
const notesDirDisplay = document.getElementById('notesDirDisplay');
const editorContainer = document.getElementById('editorContainer');
const editorPane = document.getElementById('editorPane');
const documentOutline = document.getElementById('documentOutline');

const editorRight = createCodeEditor(document.getElementById('editorRight'));
lastActiveEditor = editor;
const previewRight = document.getElementById('previewRight');
const noteTitleRight = document.getElementById('noteTitleRight');
const editorContainerRight = document.getElementById('editorContainerRight');
const editorPaneRight = document.getElementById('editorPaneRight');
const documentOutlineRight = document.getElementById('documentOutlineRight');
const rightPanel = document.getElementById('rightPanel');
const leftPanel = document.getElementById('leftPanel');
const panelDivider = document.getElementById('panelDivider');
const closeRightBtn = document.getElementById('closeRightBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const editorFindBar = document.getElementById('editorFindBar');
const editorFindInput = document.getElementById('editorFindInput');
const editorFindCount = document.getElementById('editorFindCount');
const editorFindPrevious = document.getElementById('editorFindPrevious');
const editorFindNext = document.getElementById('editorFindNext');
const editorFindClose = document.getElementById('editorFindClose');
const aiProgress = document.getElementById('aiProgress');
const aiProgressLabel = document.getElementById('aiProgressLabel');
const aiProgressBar = document.getElementById('aiProgressBar');
const releaseNotes = [
  {
    version: '1.1.3',
    date: '2026-07-26',
    title: '大纲与代码块交互',
    content: '完善文档大纲的折叠、定位与自适应布局；新增代码语言筛选，'
      + '并修复选择语言后的代码块焦点。',
    paragraphs: [
      '这一版集中优化长文档导航和代码块输入流程，让目录浏览、标题定位和代码录入'
        + '保持连续，减少重复点击与手动寻找焦点。',
      '文档大纲新增折叠与展开功能并记住用户选择。大纲会根据标题数量自适应高度，'
        + '顶部位置保持不变，长目录达到窗口可用高度后在内部滚动；点击目录项时，'
        + '对应标题会显示短暂高亮，帮助确认跳转位置。',
      '输入代码围栏并按回车后，会打开可搜索的语言选择器。支持按语言名称或'
        + 'js、ts、py、sh、xml 等常用简称筛选，也可以使用方向键、回车和 Esc 完成操作。',
      '选择语言后，焦点会在代码块完成最终渲染后稳定落入可编辑内容，可立即输入代码。'
        + '更新说明同时为每个版本补充发布日期，版本信息更完整。'
    ],
    highlights: ['文档大纲', '语言筛选', '焦点与版本信息']
  },
  {
    version: '1.1.2',
    date: '2026-07-26',
    title: 'AI 翻译与工作区体验',
    content: '新增 DeepSeek 中英文翻译和选区 AI 操作；完善工作区恢复、隐藏目录管理、'
      + '更新说明与长文档编辑稳定性。',
    paragraphs: [
      '这一版继续扩展 AI 写作能力，并集中修复长文档编辑、目录管理和窗口交互中的问题，'
        + '让应用重启后的工作状态衔接得更加自然。',
      'AI 菜单新增中英文翻译，按照技术文档习惯保留代码、路径、命令和专业术语。'
        + '选中文字后，可以通过右键菜单直接执行 AI 排版或翻译，只替换当前选区；'
        + '未选择文字时，也可以从顶部 AI 菜单翻译整篇笔记。',
      '刷新或重新打开应用后，会恢复左右编辑区当前打开的笔记、活动页面以及目录树的'
        + '折叠状态，减少重新定位文件和工作位置的操作。',
      '基本设置新增隐藏目录管理，可以查看、编辑、删除或从当前笔记库中新增隐藏目录，'
        + '并支持选择以点号开头的文件夹。设置页面会根据内容调整高度，弹窗支持点击外部'
        + '或按 Esc 关闭。',
      '更新说明改为在当前编辑区展示并突出当前版本，过往版本统一折叠。'
        + '同时修复长文档滚动时预渲染中断、预览交互导致滚动跳动，以及跨区域选择内容的问题。'
    ],
    highlights: ['AI 翻译与选区操作', '工作区恢复', '目录与弹窗管理', '编辑稳定性']
  },
  {
    version: '1.1.1',
    date: '2026-07-25',
    title: 'AI 标记与设置体验',
    content: '重新设计设置页面，以基本设置、AI 设置和功能开关分区展示；'
      + '增加 AI 排版印章、角标样式、展示位置与切换动画。',
    paragraphs: [
      '这一版集中整理了设置与 AI 排版体验，让常用选项更容易找到，'
        + '也让经过 AI 优化的文章拥有清晰但克制的状态标识。',
      '设置页面现在分为基本设置、AI 设置和功能开关三个区域。'
        + '切换不同设置时，页面顶部保持稳定，减少浏览和调整选项时的视线跳动。',
      'AI 排版文章可以使用印章或右上角飘带进行标记，并能选择不展示、'
        + '右上角或右下角等位置。标记会随正文滚动，不遮挡内容。',
      '同时优化了设置页签、印章选项和弹窗的切换动画，整体反馈更柔和，'
        + '在保持辨识度的同时尽量减少对写作的干扰。'
    ],
    highlights: ['设置分区', '排版标记', '交互细节']
  },
  {
    version: '1.1.0',
    date: '2026-07-25',
    title: 'AI 排版与正文查找',
    content: '接入 DeepSeek 排版能力，支持维护 API Key 和提示词；'
      + '新增编辑器顶部查找栏、命中导航和编辑区进度展示。',
    paragraphs: [
      '这一版为编辑器加入 AI 排版能力，可以将当前文章连同自定义提示词提交给 DeepSeek，'
        + '并把优化后的 Markdown 内容直接写回编辑区域。',
      '设置页面支持在本地维护 API Key 和排版提示词。调用期间，当前编辑区顶部会显示'
        + '预计进度，不影响其他编辑区域继续浏览。',
      '同时加入正文查找栏，支持快捷键打开、命中高亮以及上下循环导航，'
        + '长文章中的定位操作更加直接。'
    ],
    highlights: ['AI 设置', '正文查找']
  },
  {
    version: '1.0.6',
    date: '2026-07-24',
    title: '发布构建修复',
    content: '修复版本标签触发发布时的自动构建流程，提高 macOS 安装包发布的稳定性。',
    paragraphs: [
      '修复版本标签触发发布时的自动构建流程，解决安装包生成与发布步骤衔接不稳定的问题。',
      '完善版本校验和构建产物处理，提高 macOS DMG 安装包发布的可靠性。'
    ],
    highlights: ['构建可靠性']
  },
  {
    version: '1.0.5',
    date: '2026-07-24',
    title: '自动发布',
    content: '新增基于版本标签的自动构建与发布流程，可自动生成 macOS DMG 安装包。',
    paragraphs: [
      '新增基于 Git 版本标签的自动发布流程，减少手工打包和整理发布文件的操作。',
      '推送新版本标签后，系统会自动构建 macOS DMG 安装包，并将版本化文件加入发布页面。'
    ],
    highlights: ['标签发布']
  },
  {
    version: '1.0.4',
    date: '2026-07-23',
    title: 'Markdown 阅读配色',
    content: '优化 Markdown 列表、缩进和正文层级的配色，使编辑状态与预渲染内容更协调。',
    paragraphs: [
      '重新整理 Markdown 正文、标题、链接、代码和引用的颜色关系，'
        + '让不同结构在明暗主题下都保持清晰层级。',
      '统一列表标记、任务状态和缩进内容的视觉表现，使源码编辑与预渲染效果更加协调。'
    ],
    highlights: ['列表与任务']
  },
  {
    version: '1.0.3',
    date: '2026-07-19',
    title: '导航与视图控制',
    content: '改进笔记导航与视图控制，完善图片存储目录设置、路径校验和异常状态恢复。',
    paragraphs: [
      '改进笔记导航和视图控制，常用的侧边栏、预览区域与窗口操作更加稳定。',
      '新增图片存储目录设置，并补充路径校验、无效目录提示和取消选择后的状态恢复，'
        + '避免图片保存位置异常影响编辑。'
    ],
    highlights: ['图片目录']
  },
  {
    version: '1.0.2',
    date: '2026-07-18',
    title: 'Markdown 快速编辑',
    content: '新增斜杠菜单与 Markdown 结构化键盘编辑，优化列表续写、缩进、'
      + '标题和引用输入体验，并修复光标对齐。',
    paragraphs: [
      '加入斜杠菜单，可在空行快速插入标题、列表、引用、代码块等常用 Markdown 结构。',
      '增强回车、Tab、Shift+Tab 和退格键的结构化编辑行为，'
        + '列表续写、层级缩进和退出空列表更符合连续写作习惯。',
      '修复普通正文与不同级别标题中的光标高度和垂直对齐问题，提升输入时的视觉稳定性。'
    ],
    highlights: ['键盘编辑', '光标对齐']
  },
  {
    version: '1.0.1',
    date: '2026-07-17',
    title: '丰富编辑交互',
    content: '补充 Markdown 富文本式编辑交互，让常用格式在编辑区中更直观、更易操作。',
    paragraphs: [
      '补充 Markdown 富文本式编辑交互，让标题、强调、链接等常用格式在正文中更直观。',
      '优化编辑状态与展示状态之间的衔接，在保留 Markdown 源码可控性的同时减少视觉干扰。'
    ],
    highlights: ['源码与展示']
  },
  {
    version: '1.0.0',
    date: '2026-07-16',
    title: '简记首次发布',
    content: '提供 Markdown 编辑与预览、文件夹笔记管理、双栏编辑、多窗口、'
      + '主题切换、阅读模式和本地图片存储。',
    paragraphs: [
      '简记首次发布，提供 Markdown 编辑与实时预览，并支持代码块语法高亮和本地文件存储。',
      '笔记可以通过文件夹组织，也可以使用双栏编辑和多个应用窗口并排查看不同内容。',
      '首个版本同时包含明暗主题、纯阅读模式、禅模式，以及从剪贴板保存本地图片和文件。'
    ],
    highlights: ['工作空间', '阅读与资源']
  }
];

function setReleaseNotesHeading(pane, visible) {
  const headingRow = pane.closest('.editor-panel')?.querySelector('.note-heading-row');
  if (!headingRow) return;

  headingRow.classList.toggle('release-notes-heading', visible);
  headingRow.querySelector('.release-notes-title')?.remove();
  if (!visible) return;

  const title = document.createElement('span');
  title.className = 'release-notes-title';
  title.textContent = '更新说明';
  headingRow.appendChild(title);
}

function closeReleaseNotes(pane, editorAdapter, restoreFocus = true) {
  const view = pane.querySelector('.editor-release-notes');
  if (!view) return false;
  view.remove();
  pane.classList.remove('release-notes-open');
  setReleaseNotesHeading(pane, false);
  saveWorkspaceSession();
  requestAnimationFrame(() => {
    editorAdapter.codeMirror.refresh();
    if (restoreFocus) editorAdapter.focus();
  });
  return true;
}

function formatReleaseDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function createReleaseDetails(release, featured = false) {
  const body = document.createElement('div');
  body.className = featured
    ? 'editor-release-featured-body'
    : 'editor-release-content-body';
  const paragraphs = release.paragraphs || [release.content];
  const releaseDate = document.createElement('time');
  releaseDate.className = 'editor-release-date';
  releaseDate.dateTime = release.date;
  releaseDate.textContent = `发布于 ${formatReleaseDate(release.date)}`;
  const overview = document.createElement('p');
  overview.className = 'editor-release-overview';
  overview.textContent = paragraphs[0];
  body.append(releaseDate, overview);

  if (paragraphs.length > 1) {
    const changes = document.createElement('div');
    changes.className = 'editor-release-changes';
    paragraphs.slice(1).forEach((text, index) => {
      const item = document.createElement('section');
      item.className = 'editor-release-change';
      const label = document.createElement('strong');
      label.textContent = release.highlights?.[index] || '体验改进';
      const description = document.createElement('p');
      description.textContent = text;
      item.append(label, description);
      changes.appendChild(item);
    });
    body.appendChild(changes);
  }

  return body;
}

function createReleaseNotesView(currentVersion) {
  const view = document.createElement('section');
  view.className = 'editor-release-notes';
  view.setAttribute('aria-label', '更新说明');

  const list = document.createElement('div');
  list.className = 'editor-release-list';
  const currentRelease = releaseNotes.find(release => release.version === currentVersion)
    || releaseNotes[0];
  const history = releaseNotes.filter(release => release !== currentRelease);

  const currentCard = document.createElement('article');
  currentCard.className = 'editor-release-featured';
  const currentMeta = document.createElement('div');
  currentMeta.className = 'editor-release-featured-meta';
  const currentLabel = document.createElement('span');
  currentLabel.textContent = '当前版本';
  const currentVersionLabel = document.createElement('strong');
  currentVersionLabel.textContent = `v${currentRelease.version}`;
  currentMeta.append(currentLabel, currentVersionLabel);
  const currentCopy = document.createElement('div');
  currentCopy.className = 'editor-release-featured-copy';
  const currentTitle = document.createElement('h3');
  currentTitle.textContent = currentRelease.title;
  const currentBody = createReleaseDetails(currentRelease, true);
  currentCopy.append(currentTitle, currentBody);
  currentCard.append(currentMeta, currentCopy);
  list.appendChild(currentCard);

  const historyGroup = document.createElement('details');
  historyGroup.className = 'editor-release-history';
  const historySummary = document.createElement('summary');
  const historyHeading = document.createElement('span');
  historyHeading.className = 'editor-release-history-heading';
  historyHeading.textContent = '过往版本';
  const historyCount = document.createElement('span');
  historyCount.className = 'editor-release-history-count';
  historyCount.textContent = `${history.length} 个版本`;
  const historyDisclosure = document.createElement('span');
  historyDisclosure.className = 'editor-release-disclosure';
  historyDisclosure.setAttribute('aria-hidden', 'true');
  historySummary.append(historyHeading, historyCount, historyDisclosure);

  const historyList = document.createElement('div');
  historyList.className = 'editor-release-history-list';

  history.forEach(release => {
    const block = document.createElement('details');
    block.className = 'editor-release-block';

    const summary = document.createElement('summary');
    const version = document.createElement('span');
    version.className = 'editor-release-version';
    version.textContent = release.version;
    const releaseTitle = document.createElement('span');
    releaseTitle.className = 'editor-release-title';
    releaseTitle.textContent = release.title;
    summary.append(version, releaseTitle);

    const disclosure = document.createElement('span');
    disclosure.className = 'editor-release-disclosure';
    disclosure.setAttribute('aria-hidden', 'true');
    summary.appendChild(disclosure);

    const content = document.createElement('div');
    content.className = 'editor-release-content';
    content.appendChild(createReleaseDetails(release));
    block.append(summary, content);
    historyList.appendChild(block);
  });

  historyGroup.append(historySummary, historyList);
  list.appendChild(historyGroup);
  view.appendChild(list);
  return view;
}

function showReleaseNotes(event, currentVersion) {
  const editorAdapter = lastActiveEditor || editor;
  const pane = editorAdapter === editorRight ? editorPaneRight : editorPane;
  const existingView = pane.querySelector('.editor-release-notes');

  if (existingView) {
    existingView.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  closeEditorFind();
  openReleaseNotesVersion = currentVersion;
  pane.classList.add('release-notes-open');
  setReleaseNotesHeading(pane, true);
  pane.appendChild(createReleaseNotesView(currentVersion));
  saveWorkspaceSession();
}

function getTreeNoteByPath(items, notePath) {
  for (const item of items) {
    if (item.type === 'file' && item.path === notePath) return item;
    if (item.type === 'folder') {
      const child = getTreeNoteByPath(item.children || [], notePath);
      if (child) return child;
    }
  }
  return null;
}

function getTreeFolderPaths(items, paths = new Set()) {
  items.forEach(item => {
    if (item.type !== 'folder') return;
    paths.add(item.path);
    getTreeFolderPaths(item.children || [], paths);
  });
  return paths;
}

function saveWorkspaceSession() {
  if (restoringWorkspaceSession) return;
  const releasePane = editorPane.classList.contains('release-notes-open')
    ? 'left'
    : editorPaneRight.classList.contains('release-notes-open') ? 'right' : null;
  const session = {
    leftNotePath: currentNote?.path || null,
    rightNotePath: currentNoteRight?.path || null,
    activePane: lastActiveEditor === editorRight ? 'right' : 'left',
    releasePane,
    releaseVersion: openReleaseNotesVersion,
    expandedFolderPaths: [...expandedFolders]
  };
  localStorage.setItem(workspaceSessionKey, JSON.stringify(session));
}

async function restoreWorkspaceSession() {
  if (workspaceSessionRestored) return;
  workspaceSessionRestored = true;

  let session;
  try {
    session = JSON.parse(localStorage.getItem(workspaceSessionKey) || 'null');
  } catch (err) {
    localStorage.removeItem(workspaceSessionKey);
    return;
  }
  if (!session || typeof session !== 'object') return;

  restoringWorkspaceSession = true;
  try {
    const validFolderPaths = getTreeFolderPaths(tree);
    const savedFolderPaths = Array.isArray(session.expandedFolderPaths)
      ? session.expandedFolderPaths
      : [];
    expandedFolders = new Set(
      savedFolderPaths.filter(folderPath => validFolderPaths.has(folderPath))
    );
    renderTree();

    const leftNote = getTreeNoteByPath(tree, session.leftNotePath);
    if (leftNote) await selectNote(leftNote);

    const rightNote = getTreeNoteByPath(tree, session.rightNotePath);
    if (rightNote && rightNote.path !== leftNote?.path) {
      await openInRightPanel(rightNote);
    }

    lastActiveEditor = session.activePane === 'right' && currentNoteRight
      ? editorRight
      : editor;

    if (session.releasePane === 'right' && currentNoteRight) {
      lastActiveEditor = editorRight;
    } else if (session.releasePane === 'left') {
      lastActiveEditor = editor;
    } else {
      return;
    }

    const appVersion = await ipcRenderer.invoke('get-app-version');
    showReleaseNotes(null, appVersion);
  } finally {
    restoringWorkspaceSession = false;
    saveWorkspaceSession();
  }
}

function mountAiLayoutMark(editorAdapter, pane) {
  const mark = pane.querySelector('.ai-layout-mark');
  const lines = editorAdapter.codeMirror.getWrapperElement()
    .querySelector('.CodeMirror-lines');
  if (mark && lines) lines.appendChild(mark);
}

mountAiLayoutMark(editor, editorPane);
mountAiLayoutMark(editorRight, editorPaneRight);

const editorFindState = {
  editor: null,
  matches: [],
  currentIndex: -1,
  marks: [],
  updateFrame: null
};

function clearEditorFindMarks() {
  editorFindState.marks.forEach(mark => mark.clear());
  editorFindState.marks = [];
}

function updateEditorFindControls() {
  const count = editorFindState.matches.length;
  const current = count ? editorFindState.currentIndex + 1 : 0;
  editorFindCount.textContent = `${current} / ${count}`;
  editorFindPrevious.disabled = !count;
  editorFindNext.disabled = !count;
}

function renderEditorFindMatches(scrollToCurrent = true) {
  clearEditorFindMarks();
  updateEditorFindControls();
  if (!editorFindState.editor || editorFindState.currentIndex < 0) return;

  const codeMirror = editorFindState.editor.codeMirror;
  codeMirror.operation(() => {
    editorFindState.matches.forEach((match, index) => {
      const className = index === editorFindState.currentIndex
        ? 'cm-find-match cm-find-match-current'
        : 'cm-find-match';
      const mark = codeMirror.markText(
        codeMirror.posFromIndex(match.from),
        codeMirror.posFromIndex(match.to),
        { className }
      );
      editorFindState.marks.push(mark);
    });
  });

  if (!scrollToCurrent) return;
  const current = editorFindState.matches[editorFindState.currentIndex];
  codeMirror.setCursor(codeMirror.posFromIndex(current.from));
  codeMirror.scrollIntoView({
    from: codeMirror.posFromIndex(current.from),
    to: codeMirror.posFromIndex(current.to)
  }, 80);
}

function updateEditorFindMatches(preserveCurrent = false) {
  if (!editorFindState.editor) return;

  const codeMirror = editorFindState.editor.codeMirror;
  const currentMark = editorFindState.marks[editorFindState.currentIndex];
  const currentPosition = preserveCurrent ? currentMark?.find() : null;
  const previousFrom = currentPosition
    ? codeMirror.indexFromPos(currentPosition.from)
    : null;
  editorFindState.matches = findEditorMatches(
    codeMirror.getValue(),
    editorFindInput.value
  );
  const startIndex = previousFrom ?? codeMirror.indexFromPos(codeMirror.getCursor());
  editorFindState.currentIndex = getClosestEditorMatchIndex(
    editorFindState.matches,
    startIndex
  );
  renderEditorFindMatches();
}

function scheduleEditorFindUpdate(editorAdapter) {
  if (
    editorFindBar.hidden
    || editorFindState.editor !== editorAdapter
    || editorFindState.updateFrame
  ) return;
  editorFindState.updateFrame = requestAnimationFrame(() => {
    editorFindState.updateFrame = null;
    updateEditorFindMatches(true);
  });
}

function navigateEditorFind(direction) {
  editorFindState.currentIndex = getNextEditorMatchIndex(
    editorFindState.currentIndex,
    editorFindState.matches.length,
    direction
  );
  renderEditorFindMatches();
  editorFindInput.focus();
}

function openEditorFind(editorAdapter) {
  const previousEditor = editorFindState.editor;
  if (previousEditor && previousEditor !== editorAdapter) {
    clearEditorFindMarks();
  }
  editorFindState.editor = editorAdapter;
  const container = editorAdapter === editorRight ? editorContainerRight : editorContainer;
  container.before(editorFindBar);
  editorFindBar.hidden = false;
  updateEditorFindMatches();
  editorFindInput.focus();
  editorFindInput.select();
}

function closeEditorFind() {
  const previousEditor = editorFindState.editor;
  clearEditorFindMarks();
  editorFindBar.hidden = true;
  editorFindState.editor = null;
  editorFindState.matches = [];
  editorFindState.currentIndex = -1;
  updateEditorFindControls();
  previousEditor?.focus();
}

function isEditorFindUnavailable() {
  return Boolean(
    document.querySelector('.modal.active')
    || app.classList.contains('reading-mode')
  );
}

editorFindInput.addEventListener('input', () => updateEditorFindMatches());
editorFindInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  navigateEditorFind(event.shiftKey ? -1 : 1);
});
editorFindPrevious.addEventListener('click', () => navigateEditorFind(-1));
editorFindNext.addEventListener('click', () => navigateEditorFind(1));
editorFindClose.addEventListener('click', closeEditorFind);
editor.codeMirror.on('change', () => scheduleEditorFindUpdate(editor));
editorRight.codeMirror.on('change', () => scheduleEditorFindUpdate(editorRight));

document.addEventListener('keydown', event => {
  if (
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && event.key.toLowerCase() === 'f'
  ) {
    if (isEditorFindUnavailable()) return;
    event.preventDefault();
    event.stopPropagation();
    openEditorFind(lastActiveEditor || editor);
  } else if (event.key === 'Escape' && !editorFindBar.hidden) {
    if (document.querySelector('.modal.active')) return;
    event.preventDefault();
    event.stopPropagation();
    closeEditorFind();
  }
}, true);

[preview, previewRight].forEach(container => {
  container.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || !container.contains(link)) return;
    event.preventDefault();
    ipcRenderer.invoke('open-external-url', link.href);
  });
});

function getCodeMirrorContext(cm) {
  const lines = Array.from({ length: cm.lineCount() }, (_, line) => cm.getLine(line));
  return analyzeLineContext(lines, cm.getCursor());
}

function renderSlashCommandMenu() {
  slashCommandMenuElement.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'slash-command-heading';
  heading.textContent = 'Markdown 结构';
  slashCommandMenuElement.appendChild(heading);

  if (!slashCommandState.commands.length) {
    const empty = document.createElement('div');
    empty.className = 'slash-command-empty';
    empty.textContent = '没有匹配的结构';
    slashCommandMenuElement.appendChild(empty);
  }

  slashCommandState.commands.forEach((command, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.id = `slash-command-${command.id}`;
    option.className = 'slash-command-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === slashCommandState.selectedIndex));

    const icon = document.createElement('span');
    icon.className = 'slash-command-icon';
    icon.textContent = command.hint;
    const label = document.createElement('span');
    label.textContent = command.label;
    const hint = document.createElement('span');
    hint.className = 'slash-command-hint';
    hint.textContent = command.prefix;
    option.append(icon, label, hint);
    option.addEventListener('mousemove', () => {
      if (slashCommandState.selectedIndex === index) return;
      slashCommandState.selectedIndex = index;
      renderSlashCommandMenu();
    });
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      slashCommandState.selectedIndex = index;
      selectSlashCommand();
    });
    slashCommandMenuElement.appendChild(option);
  });

  const help = document.createElement('div');
  help.className = 'slash-command-help';
  help.textContent = '↑↓ 选择 · Enter 插入 · Esc 关闭';
  slashCommandMenuElement.appendChild(help);

  const selected = slashCommandState.commands[slashCommandState.selectedIndex];
  if (slashCommandState.editor) {
    setSlashCommandAccessibility(
      slashCommandState.editor.codeMirror.getInputField(),
      selected ? `slash-command-${selected.id}` : null
    );
  }
}

function positionSlashCommandMenu(cm) {
  const cursor = cm.cursorCoords(cm.getCursor(), 'window');
  const panel = cm.getWrapperElement().closest('.editor-panel').getBoundingClientRect();
  slashCommandMenuElement.style.width = '';
  slashCommandMenuElement.style.maxWidth = `${Math.max(panel.width - 16, 1)}px`;
  const menu = slashCommandMenuElement.getBoundingClientRect();
  const layout = getSlashCommandMenuLayout(panel, cursor, menu, window.innerHeight);
  slashCommandMenuElement.style.maxWidth = `${layout.maxWidth}px`;
  slashCommandMenuElement.style.left = `${layout.left}px`;
  slashCommandMenuElement.style.top = `${layout.top}px`;
}

function closeSlashCommandMenu() {
  const previousEditor = slashCommandState.editor;
  if (previousEditor) {
    clearSlashCommandAccessibility(previousEditor.codeMirror.getInputField());
  }
  slashCommandState.editor = null;
  slashCommandState.query = '';
  slashCommandState.commands = [];
  slashCommandState.selectedIndex = 0;
  slashCommandMenuElement.hidden = true;
  slashCommandMenuElement.style.width = '';
  slashCommandMenuElement.style.maxWidth = '';
  slashCommandMenuElement.replaceChildren();
}

function openSlashCommandMenu(editorAdapter, query) {
  if (slashCommandState.editor && slashCommandState.editor !== editorAdapter) {
    clearSlashCommandAccessibility(slashCommandState.editor.codeMirror.getInputField());
  }
  slashCommandState.editor = editorAdapter;
  slashCommandState.query = query;
  slashCommandState.commands = filterStructureCommands(query);
  slashCommandState.selectedIndex = 0;
  slashCommandMenuElement.hidden = false;
  renderSlashCommandMenu();
  positionSlashCommandMenu(editorAdapter.codeMirror);
}

function updateSlashCommandMenu(editorAdapter, query) {
  openSlashCommandMenu(editorAdapter, query);
}

function moveSlashCommandSelection(delta) {
  const count = slashCommandState.commands.length;
  if (!count) return;
  slashCommandState.selectedIndex = getNextSlashCommandIndex(
    slashCommandState.selectedIndex,
    delta,
    count
  );
  renderSlashCommandMenu();
  const selected = slashCommandMenuElement.querySelector('[aria-selected="true"]');
  selected?.scrollIntoView({ block: 'nearest' });
}

function selectSlashCommand() {
  const command = slashCommandState.commands[slashCommandState.selectedIndex];
  const editorAdapter = slashCommandState.editor;
  if (!command || !editorAdapter) return;

  const cm = editorAdapter.codeMirror;
  const cursor = cm.getCursor();
  const edit = getSlashCommandEdit(cm.getValue().split('\n'), cursor, {
    expectedQuery: slashCommandState.query,
    prefix: command.prefix,
    ownsMenu: slashCommandState.editor === editorAdapter && lastActiveEditor === editorAdapter,
    hasCurrentNote: editorHasCurrentNote(editorAdapter),
    selectionEmpty: !cm.somethingSelected()
  });
  if (!edit) {
    closeSlashCommandMenu();
    return;
  }

  applyCodeMirrorEdit(cm, edit);
  editorAdapter.focus();
  closeSlashCommandMenu();
}

const slashCommandMenu = {
  open: openSlashCommandMenu,
  update: updateSlashCommandMenu,
  move: moveSlashCommandSelection,
  select: selectSlashCommand,
  close: closeSlashCommandMenu
};

function editorHasCurrentNote(editorAdapter) {
  return editorAdapter === editor ? Boolean(currentNote) : Boolean(currentNoteRight);
}

function updateSlashCommandForEditor(editorAdapter) {
  const cm = editorAdapter.codeMirror;
  const cursor = cm.getCursor();
  const update = getSlashMenuUpdate(cm.getValue().split('\n'), cursor, {
    hasCurrentNote: editorHasCurrentNote(editorAdapter),
    composing: slashCommandState.composing
  });
  if (update) {
    slashCommandMenu.update(editorAdapter, update.query);
  } else if (slashCommandState.editor === editorAdapter) {
    slashCommandMenu.close();
  }
}

function scheduleEditorDecorations(editorAdapter, getNote) {
  if (editorAdapter.decorationFrame || editorAdapter.renderingDecorations) return;
  editorAdapter.decorationFrame = requestAnimationFrame(() => {
    editorAdapter.decorationFrame = null;
    if (editorAdapter.renderingDecorations) return;
    const codeMirror = editorAdapter.codeMirror;
    const scrollTop = codeMirror.getScrollInfo().top;
    codeMirror.operation(() => {
      renderEditorDecorations(editorAdapter, getNote());
    });
    if (codeMirror.getScrollInfo().top !== scrollTop) {
      codeMirror.scrollTo(null, scrollTop);
    }
  });
}

editor.codeMirror.on('cursorActivity', () => {
  lastActiveEditor = editor;
  if (slashCommandState.editor && slashCommandState.editor !== editor) {
    slashCommandMenu.close();
  }
  updateSlashCommandForEditor(editor);
  scheduleEditorDecorations(editor, () => currentNote);
  updateDocumentOutlineSelection(editor, documentOutline);
});
editor.codeMirror.on('focus', () => {
  lastActiveEditor = editor;
  if (slashCommandState.editor && slashCommandState.editor !== editor) slashCommandMenu.close();
  updateSlashCommandForEditor(editor);
});
editor.codeMirror.on('viewportChange', () => {
  scheduleEditorDecorations(editor, () => currentNote);
});
editorRight.codeMirror.on('cursorActivity', () => {
  lastActiveEditor = editorRight;
  if (slashCommandState.editor && slashCommandState.editor !== editorRight) {
    slashCommandMenu.close();
  }
  updateSlashCommandForEditor(editorRight);
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
  updateDocumentOutlineSelection(editorRight, documentOutlineRight);
});
editorRight.codeMirror.on('focus', () => {
  lastActiveEditor = editorRight;
  if (slashCommandState.editor && slashCommandState.editor !== editorRight) {
    slashCommandMenu.close();
  }
  updateSlashCommandForEditor(editorRight);
});
editorRight.codeMirror.on('viewportChange', () => {
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
});

function bindEditorSelectionContextMenu(editorAdapter) {
  editorAdapter.codeMirror.getWrapperElement().addEventListener('contextmenu', event => {
    if (!editorAdapter.codeMirror.somethingSelected()) return;
    event.preventDefault();
    lastActiveEditor = editorAdapter;
    ipcRenderer.send('show-editor-selection-context-menu');
  });
}

bindEditorSelectionContextMenu(editor);
bindEditorSelectionContextMenu(editorRight);

function createCodeEditor(textarea) {
  let suppressChange = false;
  const inputHandlers = [];
  let editorAdapter = null;
  const markdownKeyHandlers = createMarkdownKeyHandlers({
    Pass: CodeMirror.Pass,
    getMenuState: () => ({
      hidden: slashCommandMenuElement.hidden,
      editor: slashCommandState.editor,
      composing: slashCommandState.composing,
      commands: slashCommandState.commands
    }),
    selectSlashCommand,
    moveSlashCommandSelection,
    closeSlashCommandMenu,
    handleOpeningCodeFence,
    getContext: getCodeMirrorContext,
    getEnterEdit,
    getIndentEdit,
    getBackspaceEdit,
    applyEdit: applyCodeMirrorEdit
  })(() => editorAdapter);
  const codeMirror = CodeMirror.fromTextArea(textarea, {
    mode: 'markdown',
    lineWrapping: true,
    // The active source line uses the proportional Chinese reading font, where
    // six half-width spaces are approximately as wide as two Chinese glyphs.
    indentUnit: 6,
    tabSize: 6,
    viewportMargin: 20,
    extraKeys: {
      'Cmd-A': 'selectAll',
      'Ctrl-A': 'selectAll',
      ...markdownKeyHandlers
    }
  });

  codeMirror.on('scroll', closeSlashCommandMenu);
  codeMirror.on('blur', closeSlashCommandMenu);

  codeMirror.on('change', () => {
    editorAdapter.decorationStructureDirty = true;
    if (!suppressChange) inputHandlers.forEach(handler => handler());
  });

  codeMirror.on('inputRead', () => {
    if (!suppressChange) updateSlashCommandForEditor(editorAdapter);
  });

  const inputField = codeMirror.getInputField();
  inputField.addEventListener('compositionstart', () => {
    slashCommandState.composing = true;
  });
  inputField.addEventListener('compositionend', () => {
    slashCommandState.composing = false;
    updateSlashCommandForEditor(editorAdapter);
  });

  editorAdapter = {
    codeMirror,
    decorationMarks: [],
    decorationLines: [],
    decorationWidgets: [],
    decorationFrame: null,
    cursorAlignmentFrame: null,
    renderingDecorations: false,
    decorationStructureDirty: true,
    collapsedHeadings: new Set(),
    codeBlocks: [],
    get value() {
      return codeMirror.getValue();
    },
    set value(content) {
      suppressChange = true;
      codeMirror.setValue(content || '');
      suppressChange = false;
    },
    get selectionStart() {
      return codeMirror.indexFromPos(codeMirror.getCursor('from'));
    },
    get selectionEnd() {
      return codeMirror.indexFromPos(codeMirror.getCursor('to'));
    },
    setRangeText(content, start, end) {
      const from = codeMirror.posFromIndex(start);
      codeMirror.replaceRange(content, from, codeMirror.posFromIndex(end));
      codeMirror.setCursor(codeMirror.posFromIndex(start + content.length));
    },
    setCursorIndex(index) {
      codeMirror.setCursor(codeMirror.posFromIndex(index));
    },
    hasFocus() {
      return codeMirror.hasFocus();
    },
    addEventListener(type, handler) {
      if (type === 'input') {
        inputHandlers.push(handler);
      } else {
        codeMirror.getWrapperElement().addEventListener(type, handler, true);
      }
    },
    dispatchEvent() {
      return true;
    },
    focus() {
      codeMirror.focus();
    }
  };
  return editorAdapter;
}

function filterCodeLanguages(query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return codeLanguages;
  return codeLanguages.filter(language => (
    language.keywords.some(keyword => keyword.includes(normalizedQuery))
  ));
}

function renderCodeLanguageResults() {
  codeLanguageResults.replaceChildren();
  if (!codeLanguageState.languages.length) {
    const empty = document.createElement('div');
    empty.className = 'code-language-empty';
    empty.textContent = '没有匹配的语言';
    codeLanguageResults.appendChild(empty);
    codeLanguageSearch.removeAttribute('aria-activedescendant');
    return;
  }

  codeLanguageState.languages.forEach((item, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.id = `code-language-option-${index}`;
    option.className = 'code-language-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === codeLanguageState.selectedIndex));
    const label = document.createElement('span');
    label.textContent = item.label;
    const language = document.createElement('code');
    language.textContent = item.language || 'text';
    option.append(label, language);
    option.addEventListener('mousemove', () => {
      if (codeLanguageState.selectedIndex === index) return;
      codeLanguageState.selectedIndex = index;
      renderCodeLanguageResults();
    });
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      selectCodeLanguage(item.language);
    });
    codeLanguageResults.appendChild(option);
  });

  const selectedId = `code-language-option-${codeLanguageState.selectedIndex}`;
  codeLanguageSearch.setAttribute('aria-activedescendant', selectedId);
}

function positionCodeLanguagePicker(editorAdapter, cursorPosition) {
  const panel = editorAdapter.codeMirror
    .getWrapperElement()
    .closest('.editor-panel')
    .getBoundingClientRect();
  const picker = codeLanguagePicker.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(cursorPosition.left, panel.left + margin),
    panel.right - picker.width - margin
  );
  const spaceBelow = window.innerHeight - cursorPosition.bottom - margin;
  const top = spaceBelow >= picker.height
    ? cursorPosition.bottom + 5
    : Math.max(margin, cursorPosition.top - picker.height - 5);
  codeLanguagePicker.style.left = `${Math.round(left)}px`;
  codeLanguagePicker.style.top = `${Math.round(top)}px`;
}

function closeCodeLanguagePicker() {
  pendingCodeFenceCompletion = null;
  codeLanguagePicker.hidden = true;
  codeLanguageSearch.value = '';
  codeLanguageResults.replaceChildren();
}

function applySelectedCodeLanguage(pending, language) {
  if (!pending || language === null) return;
  const safeLanguage = String(language || '').replace(/[^\w+-]/g, '');
  const codeMirror = pending.editor.codeMirror;
  const lineText = codeMirror.getLine(pending.line);
  pendingCodeFocusEditor = {
    editor: pending.editor,
    line: pending.line
  };
  codeMirror.replaceRange(
    `${pending.indentation}\`\`\`${safeLanguage}\n`
      + `${pending.indentation}\n${pending.indentation}\`\`\``,
    { line: pending.line, ch: 0 },
    { line: pending.line, ch: lineText.length }
  );
  codeMirror.setCursor({
    line: pending.line + 1,
    ch: pending.indentation.length
  });
  const targetNote = pending.editor === editorRight ? currentNoteRight : currentNote;
  scheduleEditorDecorations(pending.editor, () => targetNote);
}

function selectCodeLanguage(language) {
  const pending = pendingCodeFenceCompletion;
  pendingCodeFenceCompletion = null;
  codeLanguagePicker.hidden = true;
  codeLanguageSearch.value = '';
  codeLanguageResults.replaceChildren();
  applySelectedCodeLanguage(pending, language);
}

function showCodeLanguagePicker(editorAdapter, cursorPosition) {
  codeLanguageSearch.value = '';
  codeLanguageState.languages = codeLanguages;
  codeLanguageState.selectedIndex = 0;
  codeLanguagePicker.hidden = false;
  renderCodeLanguageResults();
  positionCodeLanguagePicker(editorAdapter, cursorPosition);
  requestAnimationFrame(() => codeLanguageSearch.focus());
}

codeLanguageSearch.addEventListener('input', () => {
  codeLanguageState.languages = filterCodeLanguages(codeLanguageSearch.value);
  codeLanguageState.selectedIndex = 0;
  renderCodeLanguageResults();
});

codeLanguageSearch.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    closeCodeLanguagePicker();
    return;
  }
  const count = codeLanguageState.languages.length;
  if (!count) return;
  if (event.key === 'ArrowDown') {
    codeLanguageState.selectedIndex = (codeLanguageState.selectedIndex + 1) % count;
  } else if (event.key === 'ArrowUp') {
    codeLanguageState.selectedIndex = (codeLanguageState.selectedIndex - 1 + count) % count;
  } else if (event.key === 'Enter') {
    const selected = codeLanguageState.languages[codeLanguageState.selectedIndex];
    selectCodeLanguage(selected.language);
    return;
  }
  renderCodeLanguageResults();
  codeLanguageResults
    .querySelector('[aria-selected="true"]')
    ?.scrollIntoView({ block: 'nearest' });
});

document.addEventListener('mousedown', event => {
  if (codeLanguagePicker.hidden || codeLanguagePicker.contains(event.target)) return;
  closeCodeLanguagePicker();
});

function handleOpeningCodeFence(cm, editorAdapter) {
  const cursor = cm.getCursor();
  const lineText = cm.getLine(cursor.line);
  const beforeCursor = lineText.slice(0, cursor.ch);
  const afterCursor = lineText.slice(cursor.ch);
  const openingFence = beforeCursor.match(/^(\s*)```[\w+-]*\s*$/);
  let insideCodeFence = false;
  for (let line = 0; line < cursor.line; line += 1) {
    if (/^\s*```/.test(cm.getLine(line))) insideCodeFence = !insideCodeFence;
  }

  if (!openingFence || afterCursor.trim() || insideCodeFence) return false;
  pendingCodeFenceCompletion = {
    editor: editorAdapter,
    line: cursor.line,
    indentation: openingFence[1]
  };
  const cursorPosition = cm.cursorCoords(cursor, 'window');
  showCodeLanguagePicker(editorAdapter, cursorPosition);
  return true;
}

let colorTheme = localStorage.getItem('color-theme') || 'dark';

function applyColorTheme(theme) {
  colorTheme = theme;
  document.documentElement.dataset.theme = theme;
  ipcRenderer.send('theme-changed', theme);
}

function setColorTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  applyColorTheme(theme);
  localStorage.setItem('color-theme', theme);
}

applyColorTheme(colorTheme);

ipcRenderer.on('request-color-theme', () => {
  ipcRenderer.send('theme-changed', colorTheme);
});

window.addEventListener('storage', event => {
  if (event.key !== 'color-theme' || (event.newValue !== 'light' && event.newValue !== 'dark')) {
    return;
  }
  applyColorTheme(event.newValue);
});

panelDivider.classList.add('hidden');

let previewHiddenLeft = localStorage.getItem('preview-hidden-left') !== 'false';

function setPreviewVisibility(visible) {
  if (typeof visible !== 'boolean') return;
  previewHiddenLeft = !visible;
  editorContainer.classList.toggle('preview-hidden', previewHiddenLeft);
  localStorage.setItem('preview-hidden-left', previewHiddenLeft);
  if (!previewHiddenLeft) updatePreview(true);
  reportPreviewVisibility();
}

if (previewHiddenLeft) {
  editorContainer.classList.add('preview-hidden');
}

let sidebarHidden = localStorage.getItem('sidebar-hidden') === 'true';
let readingSidebarVisible = false;
const app = document.querySelector('.app');

function isSidebarVisible() {
  return app.classList.contains('reading-mode')
    ? readingSidebarVisible
    : !sidebarHidden;
}

function reportSidebarVisibility() {
  ipcRenderer.send('sidebar-visibility-changed', isSidebarVisible());
}

function reportPreviewVisibility() {
  ipcRenderer.send('preview-visibility-changed', !previewHiddenLeft);
}

ipcRenderer.on('request-sidebar-visibility', reportSidebarVisibility);
ipcRenderer.on('request-preview-visibility', reportPreviewVisibility);
reportPreviewVisibility();

ipcRenderer.on('topbar-hover-changed', (event, hovered) => {
  app.classList.toggle('topbar-hovered', hovered);
});

ipcRenderer.on('zen-mode-changed', (event, enabled) => {
  app.classList.toggle('zen-mode', enabled);
  const refreshEditors = () => {
    editor.codeMirror.refresh();
    editorRight.codeMirror.refresh();
    scheduleEditorDecorations(editor, () => currentNote);
    if (enabled) editor.focus();
  };
  requestAnimationFrame(refreshEditors);
  setTimeout(refreshEditors, 260);
});

ipcRenderer.on('reading-mode-changed', (event, enabled) => {
  app.classList.toggle('reading-mode', enabled);
  readingSidebarVisible = false;
  app.classList.remove('reading-sidebar-visible');
  if (enabled) {
    closeSlashCommandMenu();
    if (!editorFindBar.hidden) closeEditorFind();
    app.classList.remove('sidebar-hidden');
    toggleSidebarBtn.title = '显示目录';
    toggleSidebarBtn.setAttribute('aria-expanded', 'false');
    updateSidebarTogglePlacement(false);
    reportSidebarVisibility();
    updatePreview(true);
  } else {
    app.classList.toggle('sidebar-hidden', sidebarHidden);
    toggleSidebarBtn.title = sidebarHidden ? '显示目录' : '隐藏目录';
    toggleSidebarBtn.setAttribute('aria-expanded', String(!sidebarHidden));
    updateSidebarTogglePlacement(!sidebarHidden);
    reportSidebarVisibility();
  }
  requestAnimationFrame(() => editor.codeMirror.refresh());
});

document.addEventListener('keydown', (event) => {
  if (document.querySelector('.modal.active')) return;
  if (event.key === 'Escape' && app.classList.contains('zen-mode')) {
    event.preventDefault();
    ipcRenderer.invoke('exit-zen-mode');
  } else if (
    app.classList.contains('reading-mode')
    && !app.classList.contains('exporting-pdf')
  ) {
    if (event.key === 'Escape') event.preventDefault();
    ipcRenderer.invoke('exit-reading-mode');
  }
});

document.addEventListener('pointerdown', event => {
  if (
    !app.classList.contains('reading-mode')
    || app.classList.contains('exporting-pdf')
  ) return;

  const target = event.target;
  const isSidebarToggle = target.closest('#toggleSidebarBtn');
  const isDirectoryNavigation = event.button === 0
    && target.closest('.tree-folder');
  const isReadingContent = event.button === 0
    && target.closest('.preview-pane, .preview-content');
  if (isSidebarToggle || isDirectoryNavigation || isReadingContent) return;
  ipcRenderer.invoke('exit-reading-mode');
}, true);

function toggleSidebar() {
  setSidebarVisibility(!isSidebarVisible());
}

function setSidebarVisibility(visible) {
  if (typeof visible !== 'boolean') return;
  if (app.classList.contains('reading-mode')) {
    readingSidebarVisible = visible;
    app.classList.toggle('reading-sidebar-visible', readingSidebarVisible);
    toggleSidebarBtn.title = readingSidebarVisible ? '隐藏目录' : '显示目录';
    toggleSidebarBtn.setAttribute('aria-expanded', String(readingSidebarVisible));
    updateSidebarTogglePlacement(readingSidebarVisible);
    reportSidebarVisibility();
    return;
  }
  sidebarHidden = !visible;
  app.classList.toggle('sidebar-hidden', sidebarHidden);
  toggleSidebarBtn.title = sidebarHidden ? '显示目录' : '隐藏目录';
  toggleSidebarBtn.setAttribute('aria-expanded', String(!sidebarHidden));
  updateSidebarTogglePlacement(!sidebarHidden);
  reportSidebarVisibility();
  localStorage.setItem('sidebar-hidden', sidebarHidden);
}

function updateSidebarTogglePlacement(expanded) {
  const sidebarHeader = document.querySelector('.sidebar-header');
  const leftToolbar = document.querySelector('#leftPanel > .toolbar');
  if (expanded) {
    sidebarHeader.appendChild(toggleSidebarBtn);
  } else {
    leftToolbar.prepend(toggleSidebarBtn);
  }
}

toggleSidebarBtn.addEventListener('click', toggleSidebar);

if (sidebarHidden) {
  app.classList.add('sidebar-hidden');
  toggleSidebarBtn.title = '显示目录';
} else {
  toggleSidebarBtn.title = '隐藏目录';
}
toggleSidebarBtn.setAttribute('aria-expanded', String(!sidebarHidden));
updateSidebarTogglePlacement(!sidebarHidden);
reportSidebarVisibility();

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalInput = document.getElementById('modalInput');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancel = document.getElementById('confirmCancel');
const confirmOk = document.getElementById('confirmOk');
const locationsModal = document.getElementById('locationsModal');
const locationsList = document.getElementById('locationsList');
const locationsAdd = document.getElementById('locationsAdd');
const settingsModal = document.getElementById('settingsModal');
const settingsTabList = settingsModal.querySelector('[role="tablist"]');
const settingsTabs = Array.from(settingsModal.querySelectorAll('[role="tab"]'));
const settingsTabPanels = Array.from(settingsModal.querySelectorAll('[role="tabpanel"]'));
const imageDirectoryPath = document.getElementById('imageDirectoryPath');
const imageDirectoryMode = document.getElementById('imageDirectoryMode');
const imageDirectoryChoose = document.getElementById('imageDirectoryChoose');
const imageDirectoryReset = document.getElementById('imageDirectoryReset');
const templateDirectoryPath = document.getElementById('templateDirectoryPath');
const templateDirectoryMode = document.getElementById('templateDirectoryMode');
const templateDirectoryChoose = document.getElementById('templateDirectoryChoose');
const templateDirectoryClear = document.getElementById('templateDirectoryClear');
const hiddenDirectoryList = document.getElementById('hiddenDirectoryList');
const hiddenDirectoryEmpty = document.getElementById('hiddenDirectoryEmpty');
const hiddenDirectoryCount = document.getElementById('hiddenDirectoryCount');
const hiddenDirectoryAdd = document.getElementById('hiddenDirectoryAdd');
const deepseekApiKey = document.getElementById('deepseekApiKey');
const deepseekLayoutPrompt = document.getElementById('deepseekLayoutPrompt');
const deepseekApiKeySave = document.getElementById('deepseekApiKeySave');
const aiSettingsStatus = document.getElementById('aiSettingsStatus');
const aiStampPositionInputs = Array.from(
  document.querySelectorAll('input[name="aiStampPosition"]')
);
const aiStampPositionControl = document.querySelector('.settings-segmented');
const outlineToggle = document.getElementById('outlineToggle');
const settingsError = document.getElementById('settingsError');
const templateModal = document.getElementById('templateModal');
const templateList = document.getElementById('templateList');
const templateError = document.getElementById('templateError');
const templateCancel = document.getElementById('templateCancel');

let modalCallback = null;
let confirmCallback = null;
let settingsPreviousFocus = null;
let settingsRequestId = 0;
let settingsBusy = false;
let settingsIsCustom = false;
let templateDirectoryIsSet = false;
let aiLayoutBusy = false;
let aiProgressTimer = null;
let aiProgressHideTimer = null;
let aiProgressAction = 'AI 优化排版';
let aiStampRequestId = 0;
let outlineEnabled = localStorage.getItem('outline-enabled') !== 'false';
let outlineCollapsed = localStorage.getItem('outline-collapsed') === 'true';
const outlineHighlightStates = new WeakMap();

function activateSettingsTab(tab, shouldFocus = false) {
  if (!settingsTabs.includes(tab)) return;
  settingsTabList.style.setProperty('--settings-tab-index', settingsTabs.indexOf(tab));
  settingsTabs.forEach(item => {
    const isActive = item === tab;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
    item.tabIndex = isActive ? 0 : -1;
  });
  settingsTabPanels.forEach(panel => {
    const isActive = panel.id === tab.getAttribute('aria-controls');
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
  if (shouldFocus) tab.focus();
}

function applyOutlineSetting() {
  app.classList.toggle('outline-hidden', !outlineEnabled);
  outlineToggle.setAttribute('aria-checked', String(outlineEnabled));
}

function applyDocumentOutlineCollapsedState() {
  [documentOutline, documentOutlineRight].forEach(container => {
    container.classList.toggle('collapsed', outlineCollapsed);
    const button = container.querySelector('.document-outline-collapse');
    if (!button) return;
    button.setAttribute('aria-expanded', String(!outlineCollapsed));
    button.setAttribute('aria-label', outlineCollapsed ? '展开文档大纲' : '折叠文档大纲');
    button.title = outlineCollapsed ? '展开大纲' : '折叠大纲';
    button.textContent = outlineCollapsed ? '‹' : '›';
  });
}

function syncDocumentOutlineWindowSpacing(container) {
  const outlineTop = container.getBoundingClientRect().top;
  if (outlineTop <= 0) return;
  const outlineHeight = Math.max(38, window.innerHeight - outlineTop * 2);
  container.style.setProperty('--document-outline-max-height', `${outlineHeight}px`);
}

applyOutlineSetting();
applyDocumentOutlineCollapsedState();
[documentOutline, documentOutlineRight].forEach(container => {
  const observer = new ResizeObserver(() => {
    requestAnimationFrame(() => syncDocumentOutlineWindowSpacing(container));
  });
  observer.observe(container.parentElement);
});
window.addEventListener('resize', () => {
  [documentOutline, documentOutlineRight].forEach(syncDocumentOutlineWindowSpacing);
});
ipcRenderer.invoke('get-ai-settings').then(result => {
  if (result.success) applyAiStampPosition(result.stampPosition);
});

function showModal(title, placeholder, defaultValue, callback) {
  modalTitle.textContent = title;
  modalInput.placeholder = placeholder;
  modalInput.value = defaultValue || '';
  modal.classList.add('active');
  modalInput.focus();
  modalCallback = callback;
}

function hideModal() {
  modal.classList.remove('active');
  modalCallback = null;
}

function showConfirm(title, message, callback) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmModal.classList.add('active');
  confirmCallback = callback;
}

function hideConfirm() {
  confirmModal.classList.remove('active');
  confirmCallback = null;
}

function renderImageDirectorySettings(data) {
  imageDirectoryPath.textContent = data.effectivePath;
  imageDirectoryMode.textContent = data.isCustom ? '自定义目录' : '默认目录';
  settingsIsCustom = data.isCustom;
  imageDirectoryReset.disabled = settingsBusy || !settingsIsCustom;
  settingsError.textContent = data.isCustom && !data.exists
    ? '自定义图片目录不存在或已被移动'
    : '';
}

function renderTemplateDirectorySettings(data) {
  templateDirectoryIsSet = Boolean(data.path);
  templateDirectoryPath.textContent = data.path || '未设置';
  templateDirectoryMode.textContent = !data.path
    ? '未设置'
    : data.exists ? '已设置' : '目录不可用';
  templateDirectoryClear.disabled = settingsBusy || !templateDirectoryIsSet;
}

function renderHiddenDirectorySettings(directories) {
  hiddenDirectoryList.replaceChildren();
  hiddenDirectoryCount.textContent = `${directories.length} 项`;
  hiddenDirectoryEmpty.hidden = directories.length > 0;

  directories.forEach(directory => {
    const row = document.createElement('div');
    row.className = 'hidden-directory-row';

    const input = document.createElement('input');
    input.className = 'hidden-directory-input';
    input.type = 'text';
    input.value = directory;
    input.dataset.originalValue = directory;
    input.setAttribute('aria-label', `隐藏目录 ${directory}`);
    input.spellcheck = false;

    const saveButton = document.createElement('button');
    saveButton.className = 'hidden-directory-action save';
    saveButton.type = 'button';
    saveButton.textContent = '保存';
    saveButton.disabled = true;

    const removeButton = document.createElement('button');
    removeButton.className = 'hidden-directory-action danger';
    removeButton.type = 'button';
    removeButton.textContent = '删除';

    input.addEventListener('input', () => {
      saveButton.disabled = settingsBusy || input.value.trim() === directory;
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !saveButton.disabled) saveButton.click();
    });
    saveButton.addEventListener('click', async () => {
      if (settingsBusy) return;
      settingsError.textContent = '';
      setSettingsBusy(true);
      try {
        const result = await ipcRenderer.invoke('update-hidden-directory', {
          previousDirectory: directory,
          nextDirectory: input.value
        });
        if (!result.success) {
          settingsError.textContent = getSettingsErrorMessage(
            '保存隐藏目录失败',
            result.error
          );
          return;
        }
        renderHiddenDirectorySettings(result.directories);
        await loadTree();
      } catch (error) {
        settingsError.textContent = getSettingsErrorMessage('保存隐藏目录失败', error);
      } finally {
        setSettingsBusy(false);
      }
    });
    removeButton.addEventListener('click', async () => {
      if (settingsBusy) return;
      settingsError.textContent = '';
      setSettingsBusy(true);
      try {
        const result = await ipcRenderer.invoke('remove-hidden-directory', directory);
        if (!result.success) {
          settingsError.textContent = getSettingsErrorMessage(
            '删除隐藏目录失败',
            result.error
          );
          return;
        }
        renderHiddenDirectorySettings(result.directories);
        await loadTree();
      } catch (error) {
        settingsError.textContent = getSettingsErrorMessage('删除隐藏目录失败', error);
      } finally {
        setSettingsBusy(false);
      }
    });

    row.append(input, saveButton, removeButton);
    hiddenDirectoryList.appendChild(row);
  });
}

function renderAiSettings(data) {
  deepseekApiKey.value = data.apiKey || '';
  deepseekLayoutPrompt.value = data.layoutPrompt || '';
  aiSettingsStatus.textContent = data.apiKey ? '已配置' : '未配置';
  applyAiStampPosition(data.stampPosition);
}

function applyAiStampPosition(position) {
  const normalizedPosition = [
    'hidden',
    'top-right',
    'bottom-right',
    'corner-ribbon'
  ].includes(position)
    ? position
    : 'top-right';
  app.dataset.aiStampPosition = normalizedPosition;
  const selectedIndex = aiStampPositionInputs.findIndex(
    input => input.value === normalizedPosition
  );
  aiStampPositionControl.style.setProperty('--stamp-column', selectedIndex);
  aiStampPositionControl.style.setProperty('--stamp-mobile-column', selectedIndex % 2);
  aiStampPositionControl.style.setProperty(
    '--stamp-mobile-row',
    Math.floor(selectedIndex / 2)
  );
  aiStampPositionInputs.forEach(input => {
    input.checked = input.value === normalizedPosition;
  });
}

function getSettingsErrorMessage(action, error) {
  const detail = typeof error === 'string' ? error : error?.message;
  return detail ? `${action}：${detail}` : action;
}

function setSettingsBusy(busy) {
  settingsBusy = busy;
  imageDirectoryChoose.disabled = busy;
  imageDirectoryReset.disabled = busy || !settingsIsCustom;
  templateDirectoryChoose.disabled = busy;
  templateDirectoryClear.disabled = busy || !templateDirectoryIsSet;
  hiddenDirectoryAdd.disabled = busy;
  hiddenDirectoryList.querySelectorAll('input, button').forEach(control => {
    control.disabled = busy;
  });
  if (!busy) {
    hiddenDirectoryList.querySelectorAll('.hidden-directory-action.save').forEach(button => {
      const input = button.closest('.hidden-directory-row')
        ?.querySelector('.hidden-directory-input');
      button.disabled = !input || input.value.trim() === input.dataset.originalValue;
    });
  }
  deepseekApiKey.disabled = busy;
  deepseekLayoutPrompt.disabled = busy;
  deepseekApiKeySave.disabled = busy;
  aiStampPositionInputs.forEach(input => {
    input.disabled = busy;
  });
}

function resetImageDirectorySettings() {
  imageDirectoryPath.textContent = '';
  imageDirectoryMode.textContent = '正在加载…';
  settingsIsCustom = false;
  imageDirectoryReset.disabled = true;
  renderTemplateDirectorySettings({ path: '', exists: false });
  renderHiddenDirectorySettings([]);
  renderAiSettings({
    apiKey: '',
    layoutPrompt: '',
    stampPosition: app.dataset.aiStampPosition
  });
}

function renderFailedImageDirectorySettings(result) {
  if (result.isCustom && result.effectivePath) {
    renderImageDirectorySettings(result);
  }
  settingsError.textContent = getSettingsErrorMessage('设置加载失败', result.error);
}

async function showSettingsDialog() {
  if (settingsModal.classList.contains('active')) return;
  settingsPreviousFocus = document.activeElement;
  settingsError.textContent = '';
  resetImageDirectorySettings();
  activateSettingsTab(settingsTabs[0]);
  settingsModal.classList.add('active');
  settingsTabs[0].focus();
  const requestId = ++settingsRequestId;
  setSettingsBusy(true);
  try {
    const [result, templateResult, hiddenResult, aiResult] = await Promise.all([
      ipcRenderer.invoke('get-image-directory'),
      ipcRenderer.invoke('get-template-directory'),
      ipcRenderer.invoke('get-hidden-directories'),
      ipcRenderer.invoke('get-ai-settings')
    ]);
    if (requestId !== settingsRequestId) return;
    if (!result.success) {
      renderFailedImageDirectorySettings(result);
      return;
    }
    renderImageDirectorySettings(result);
    if (templateResult.success) renderTemplateDirectorySettings(templateResult);
    else settingsError.textContent = getSettingsErrorMessage(
      '模板目录设置加载失败', templateResult.error
    );
    if (hiddenResult.success) renderHiddenDirectorySettings(hiddenResult.directories);
    else settingsError.textContent = getSettingsErrorMessage(
      '隐藏目录加载失败', hiddenResult.error
    );
    if (aiResult.success) renderAiSettings(aiResult);
    else settingsError.textContent = getSettingsErrorMessage(
      'AI 设置加载失败', aiResult.error
    );
  } catch (error) {
    if (requestId !== settingsRequestId) return;
    settingsError.textContent = getSettingsErrorMessage('设置加载失败', error);
  } finally {
    if (requestId === settingsRequestId) setSettingsBusy(false);
  }
}

function hideSettingsDialog() {
  if (!settingsModal.classList.contains('active')) return;
  settingsRequestId += 1;
  setSettingsBusy(false);
  settingsModal.classList.remove('active');
  if (settingsPreviousFocus?.isConnected) settingsPreviousFocus.focus();
  settingsPreviousFocus = null;
}

function normalizeAiMarkdownResponse(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function setAiProgress(value) {
  const normalizedValue = Math.max(0, Math.min(100, Math.round(value)));
  aiProgress.setAttribute('aria-valuenow', String(normalizedValue));
  aiProgressLabel.textContent = `${aiProgressAction} · 预计 ${normalizedValue}%`;
  aiProgressBar.style.width = `${normalizedValue}%`;
}

function startAiProgress(editorAdapter, action = 'AI 优化排版') {
  if (aiProgressTimer) clearInterval(aiProgressTimer);
  if (aiProgressHideTimer) clearTimeout(aiProgressHideTimer);
  aiProgressAction = action;
  const panel = editorAdapter === editorRight ? rightPanel : leftPanel;
  panel.appendChild(aiProgress);
  const startedAt = Date.now();
  aiProgress.hidden = false;
  setAiProgress(6);
  aiProgressTimer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const estimated = 8 + 84 * (1 - Math.exp(-elapsed / 18000));
    setAiProgress(Math.min(92, estimated));
  }, 400);
}

function finishAiProgress(completed) {
  if (aiProgressTimer) clearInterval(aiProgressTimer);
  aiProgressTimer = null;
  if (!completed) {
    aiProgress.hidden = true;
    return;
  }
  setAiProgress(100);
  aiProgressHideTimer = setTimeout(() => {
    aiProgress.hidden = true;
    aiProgressHideTimer = null;
  }, 500);
}

async function optimizeActiveNoteLayout(options = {}) {
  if (aiLayoutBusy) {
    showConfirm('AI 正在处理', '请等待当前排版优化完成。', () => {});
    return;
  }
  const targetEditor = lastActiveEditor === editorRight ? editorRight : editor;
  const targetNote = targetEditor === editorRight ? currentNoteRight : currentNote;
  if (!targetNote) {
    showConfirm('无法优化排版', '请先选择一篇笔记。', () => {});
    return;
  }
  const selectionOnly = options.selectionOnly === true;
  const selectionStart = targetEditor.selectionStart;
  const selectionEnd = targetEditor.selectionEnd;
  const originalContent = selectionOnly
    ? targetEditor.value.slice(selectionStart, selectionEnd)
    : targetEditor.value;
  if (!originalContent.trim()) {
    showConfirm(
      '无法优化排版',
      selectionOnly ? '请先选择要优化的正文。' : '当前笔记没有可优化的内容。',
      () => {}
    );
    return;
  }

  aiLayoutBusy = true;
  startAiProgress(targetEditor);
  let completed = false;
  try {
    const result = await ipcRenderer.invoke('deepseek-optimize-layout', originalContent);
    if (!result.success) {
      showConfirm('优化排版失败', result.error || 'DeepSeek 请求失败', () => {});
      return;
    }
    const currentTargetNote = targetEditor === editorRight ? currentNoteRight : currentNote;
    if (!currentTargetNote || currentTargetNote.path !== targetNote.path) {
      showConfirm('未应用优化结果', '等待 AI 响应期间笔记已切换，请重新执行。', () => {});
      return;
    }
    if (
      selectionOnly
      && targetEditor.value.slice(selectionStart, selectionEnd) !== originalContent
    ) {
      showConfirm('未应用优化结果', '等待 AI 响应期间选中内容已改变，请重新执行。', () => {});
      return;
    }
    const optimizedContent = normalizeAiMarkdownResponse(result.content);
    if (selectionOnly) {
      targetEditor.setRangeText(optimizedContent, selectionStart, selectionEnd);
    } else {
      targetEditor.value = optimizedContent;
    }
    if (targetEditor === editorRight) {
      updatePreviewRight(true);
      await saveCurrentNoteRight();
    } else {
      updatePreview(true);
      await saveCurrentNote();
    }
    const optimizedState = await ipcRenderer.invoke('set-ai-optimized-state', {
      notePath: currentTargetNote.path,
      optimized: true
    });
    if (!optimizedState.success) {
      throw new Error(optimizedState.error || '无法保存 AI 排版状态');
    }
    const targetPanel = targetEditor === editorRight ? rightPanel : leftPanel;
    targetPanel.classList.add('ai-layout-optimized');
    targetEditor.focus();
    completed = true;
  } catch (error) {
    showConfirm(
      '优化排版失败',
      getSettingsErrorMessage('DeepSeek 请求失败', error),
      () => {}
    );
  } finally {
    aiLayoutBusy = false;
    finishAiProgress(completed);
  }
}

async function translateActiveNote(targetLanguage) {
  if (aiLayoutBusy) {
    showConfirm('AI 正在处理', '请等待当前 AI 操作完成。', () => {});
    return;
  }
  if (!['zh', 'en'].includes(targetLanguage)) return;
  const targetEditor = lastActiveEditor === editorRight ? editorRight : editor;
  const targetNote = targetEditor === editorRight ? currentNoteRight : currentNote;
  if (!targetNote) {
    showConfirm('无法翻译', '请先选择一篇笔记。', () => {});
    return;
  }
  const selectionStart = targetEditor.selectionStart;
  const selectionEnd = targetEditor.selectionEnd;
  const selectionOnly = selectionEnd > selectionStart;
  const originalContent = selectionOnly
    ? targetEditor.value.slice(selectionStart, selectionEnd)
    : targetEditor.value;
  if (!originalContent.trim()) {
    showConfirm('无法翻译', '当前笔记没有可翻译的内容。', () => {});
    return;
  }

  aiLayoutBusy = true;
  const targetName = targetLanguage === 'zh' ? '中文' : '英文';
  startAiProgress(targetEditor, `AI 翻译为${targetName}`);
  let completed = false;
  try {
    const result = await ipcRenderer.invoke('deepseek-translate', {
      targetLanguage,
      content: originalContent
    });
    if (!result.success) {
      showConfirm('翻译失败', result.error || 'DeepSeek 请求失败', () => {});
      return;
    }
    const currentTargetNote = targetEditor === editorRight ? currentNoteRight : currentNote;
    if (!currentTargetNote || currentTargetNote.path !== targetNote.path) {
      showConfirm('未应用翻译结果', '等待 AI 响应期间笔记已切换，请重新执行。', () => {});
      return;
    }
    const currentSource = selectionOnly
      ? targetEditor.value.slice(selectionStart, selectionEnd)
      : targetEditor.value;
    if (currentSource !== originalContent) {
      showConfirm('未应用翻译结果', '等待 AI 响应期间原文已改变，请重新执行。', () => {});
      return;
    }
    const translatedContent = normalizeAiMarkdownResponse(result.content);
    if (selectionOnly) {
      targetEditor.setRangeText(translatedContent, selectionStart, selectionEnd);
    } else {
      targetEditor.value = translatedContent;
    }
    if (targetEditor === editorRight) {
      updatePreviewRight(true);
      await saveCurrentNoteRight();
    } else {
      updatePreview(true);
      await saveCurrentNote();
    }
    targetEditor.focus();
    completed = true;
  } catch (error) {
    showConfirm(
      '翻译失败',
      getSettingsErrorMessage('DeepSeek 请求失败', error),
      () => {}
    );
  } finally {
    aiLayoutBusy = false;
    finishAiProgress(completed);
  }
}

modalCancel.addEventListener('click', hideModal);
modalConfirm.addEventListener('click', () => {
  if (modalCallback) {
    modalCallback(modalInput.value.trim());
  }
  hideModal();
});

modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    modalConfirm.click();
  }
});

confirmCancel.addEventListener('click', hideConfirm);
confirmOk.addEventListener('click', () => {
  if (confirmCallback) {
    confirmCallback(true);
  }
  hideConfirm();
});

async function loadTree() {
  tree = await ipcRenderer.invoke('get-tree');
  const notesInfo = await ipcRenderer.invoke('get-notes-info');
  notesDirDisplay.textContent = notesInfo.alias || notesInfo.name;
  notesDirInfo.title = `${notesInfo.path}\n点击管理存储目录`;
  notesDirInfo.dataset.alias = notesInfo.alias;
  renderTree();
}

let treeRefreshTimer = null;

function scheduleTreeRefresh() {
  clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(loadTree, 100);
}

let previewHiddenRight = localStorage.getItem('preview-hidden-right') !== 'false';
const togglePreviewBtnRight = document.getElementById('togglePreviewBtnRight');

function togglePreviewRight() {
  previewHiddenRight = !previewHiddenRight;
  editorContainerRight.classList.toggle('preview-hidden', previewHiddenRight);
  togglePreviewBtnRight.title = previewHiddenRight ? '显示预览' : '隐藏预览';
  togglePreviewBtnRight.classList.toggle('active', !previewHiddenRight);
  localStorage.setItem('preview-hidden-right', previewHiddenRight);
  if (!previewHiddenRight) updatePreviewRight(true);
}

togglePreviewBtnRight.addEventListener('click', togglePreviewRight);

if (previewHiddenRight) {
  editorContainerRight.classList.add('preview-hidden');
  togglePreviewBtnRight.title = '显示预览';
  togglePreviewBtnRight.classList.remove('active');
} else {
  togglePreviewBtnRight.title = '隐藏预览';
  togglePreviewBtnRight.classList.add('active');
}

function renderTree() {
  notesList.innerHTML = '';
  renderTreeItems(tree, notesList, 0);
}

function renderTreeItems(items, container, level) {
  items.forEach(item => {
    if (item.type === 'folder') {
      const folderEl = createFolderElement(item, level);
      container.appendChild(folderEl);
    } else {
      const fileEl = createFileElement(item, level);
      container.appendChild(fileEl);
    }
  });
}

function createFolderElement(folder, level) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-folder-wrapper';
  
  const folderEl = document.createElement('div');
  folderEl.className = 'tree-folder';
  folderEl.style.paddingLeft = `${level * 16 + 8}px`;
  folderEl.dataset.path = folder.path;
  folderEl.dataset.type = 'folder';
  folderEl.draggable = true;
  
  const isExpanded = expandedFolders.has(folder.path);
  
  folderEl.innerHTML = `
    <span class="folder-icon"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span>
    <span class="folder-name">${escapeHtml(folder.name)}</span>
  `;
  
  folderEl.addEventListener('click', () => {
    if (expandedFolders.has(folder.path)) {
      expandedFolders.delete(folder.path);
    } else {
      expandedFolders.add(folder.path);
    }
    renderTree();
    saveWorkspaceSession();
  });
  
  folderEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuData = { type: 'folder', path: folder.path, name: folder.name };
    ipcRenderer.send('show-context-menu', contextMenuData);
  });
  
  folderEl.addEventListener('dragstart', (e) => {
    draggedItem = { type: 'folder', path: folder.path, name: folder.name };
    folderEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folder.path);
  });
  
  folderEl.addEventListener('dragend', () => {
    folderEl.classList.remove('dragging');
    draggedItem = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  
  folderEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedItem && draggedItem.path !== folder.path) {
      folderEl.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    }
  });
  
  folderEl.addEventListener('dragleave', () => {
    folderEl.classList.remove('drag-over');
  });
  
  folderEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    folderEl.classList.remove('drag-over');
    
    if (draggedItem && draggedItem.path !== folder.path) {
      moveItem(draggedItem, folder.path);
    }
  });
  
  wrapper.appendChild(folderEl);
  
  if (isExpanded && folder.children.length > 0) {
    const childrenEl = document.createElement('div');
    childrenEl.className = 'tree-folder-children';
    renderTreeItems(folder.children, childrenEl, level + 1);
    wrapper.appendChild(childrenEl);
  }
  
  return wrapper;
}

function createFileElement(file, level) {
  const isActive = (currentNote && currentNote.path === file.path) || 
                   (currentNoteRight && currentNoteRight.path === file.path);
  const fileEl = document.createElement('div');
  fileEl.className = 'tree-file' + (isActive ? ' active' : '');
  fileEl.style.paddingLeft = `${level * 16 + 32}px`;
  fileEl.dataset.path = file.path;
  fileEl.dataset.type = 'file';
  fileEl.draggable = true;
  
  fileEl.innerHTML = `
    <span class="file-name">${escapeHtml(file.name)}</span>
  `;
  
  fileEl.addEventListener('click', () => selectNote(file));
  fileEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuData = { type: 'file', path: file.path, name: file.name };
    ipcRenderer.send('show-context-menu', contextMenuData);
  });
  
  fileEl.addEventListener('dragstart', (e) => {
    draggedItem = { type: 'file', path: file.path, name: file.name };
    fileEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', file.path);
  });
  
  fileEl.addEventListener('dragend', () => {
    fileEl.classList.remove('dragging');
    draggedItem = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  
  fileEl.addEventListener('dblclick', (e) => {
    e.preventDefault();
    openInRightPanel(file);
  });
  
  return fileEl;
}

async function selectNote(note) {
  const closedLeftReleaseNotes = closeReleaseNotes(editorPane, editor, false);
  closeReleaseNotes(editorPaneRight, editorRight, false);

  if (closedLeftReleaseNotes && currentNote && currentNote.path === note.path) {
    requestAnimationFrame(() => editor.focus());
    return;
  }
  if (currentNote && currentNote.path === note.path) return;
  
  if (currentNoteRight && currentNoteRight.path === note.path) {
    closeRightPanel();
  }
  
  closeSlashCommandMenu();
  currentNote = note;
  noteTitle.value = note.name;
  const [content, optimizedState] = await Promise.all([
    ipcRenderer.invoke('read-note', note.path),
    ipcRenderer.invoke('get-ai-optimized-state', note.path)
  ]);
  if (!currentNote || currentNote.path !== note.path) return;
  editor.value = content;
  leftPanel.classList.toggle(
    'ai-layout-optimized',
    optimizedState.success && optimizedState.optimized
  );
  updatePreview(true);
  renderTree();
  saveWorkspaceSession();
}

let previewTimeout = null;

function bindPreviewTaskCheckboxes(container, editorAdapter) {
  const checkboxes = container.querySelectorAll('li > input[type="checkbox"]');
  checkboxes.forEach((checkbox, taskIndex) => {
    checkbox.disabled = false;
    checkbox.setAttribute('aria-label', checkbox.checked ? '标记为未完成' : '标记为已完成');
    checkbox.addEventListener('change', () => {
      const edit = getTaskCheckboxEdit(editorAdapter.value, taskIndex, checkbox.checked);
      if (!edit) {
        checkbox.checked = !checkbox.checked;
        return;
      }
      const codeMirror = editorAdapter.codeMirror;
      codeMirror.replaceRange(
        edit.text,
        codeMirror.posFromIndex(edit.from),
        codeMirror.posFromIndex(edit.to),
        'preview-task-toggle'
      );
    });
  });
}

function renderDocumentOutline(editorAdapter, container) {
  syncDocumentOutlineWindowSpacing(container);
  const headings = getDocumentOutline(editorAdapter.value.split('\n'));
  const topHeadingLevel = headings.length
    ? Math.min(...headings.map(heading => heading.level))
    : null;
  const cursorLine = editorAdapter.codeMirror.getCursor().line;
  const activeHeading = headings.findLast(heading => heading.line <= cursorLine);
  container.replaceChildren();
  const title = document.createElement('div');
  title.className = 'document-outline-title';
  const titleLabel = document.createElement('span');
  titleLabel.textContent = '大纲';
  const titleCount = document.createElement('span');
  titleCount.className = 'document-outline-count';
  titleCount.textContent = String(headings.length);
  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'document-outline-collapse';
  collapseButton.setAttribute('aria-controls', container.id);
  collapseButton.setAttribute('aria-expanded', String(!outlineCollapsed));
  collapseButton.addEventListener('click', () => {
    outlineCollapsed = !outlineCollapsed;
    localStorage.setItem('outline-collapsed', String(outlineCollapsed));
    applyDocumentOutlineCollapsedState();
  });
  title.append(titleLabel, titleCount, collapseButton);
  container.appendChild(title);
  applyDocumentOutlineCollapsedState();
  if (!headings.length) {
    const empty = document.createElement('div');
    empty.className = 'document-outline-empty';
    empty.textContent = '暂无标题';
    container.appendChild(empty);
    return;
  }
  headings.forEach(heading => {
    const outlineText = heading.text.replace(/\*/g, '').trim();
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'document-outline-item';
    item.dataset.level = String(heading.level);
    item.classList.toggle('top-level', heading.level === topHeadingLevel);
    item.dataset.line = String(heading.line);
    item.classList.toggle('active', heading === activeHeading);
    if (heading === activeHeading) item.setAttribute('aria-current', 'location');
    item.style.setProperty('--outline-level', heading.level - topHeadingLevel);
    item.textContent = outlineText;
    item.title = outlineText;
    item.addEventListener('click', () => {
      const codeMirror = editorAdapter.codeMirror;
      codeMirror.setCursor({ line: heading.line, ch: 0 });
      codeMirror.focus();
      requestAnimationFrame(() => {
        codeMirror.scrollTo(null, codeMirror.heightAtLine(heading.line, 'local'));
        highlightDocumentOutlineTarget(codeMirror, heading.line);
      });
    });
    container.appendChild(item);
  });
}

function highlightDocumentOutlineTarget(codeMirror, lineNumber) {
  const previous = outlineHighlightStates.get(codeMirror);
  if (previous) {
    clearTimeout(previous.timer);
    codeMirror.removeLineClass(previous.line, 'wrap', 'document-outline-target');
  }
  codeMirror.addLineClass(lineNumber, 'wrap', 'document-outline-target');
  const timer = setTimeout(() => {
    codeMirror.removeLineClass(lineNumber, 'wrap', 'document-outline-target');
    outlineHighlightStates.delete(codeMirror);
  }, 1400);
  outlineHighlightStates.set(codeMirror, { line: lineNumber, timer });
}

function updateDocumentOutlineSelection(editorAdapter, container) {
  const cursorLine = editorAdapter.codeMirror.getCursor().line;
  const items = Array.from(container.querySelectorAll('.document-outline-item'));
  let activeItem = null;
  items.forEach(item => {
    if (Number(item.dataset.line) <= cursorLine) activeItem = item;
  });
  items.forEach(item => {
    const active = item === activeItem;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'location');
    else item.removeAttribute('aria-current');
  });
}

function updatePreview(immediate = false) {
  scheduleEditorDecorations(editor, () => currentNote);
  renderDocumentOutline(editor, documentOutline);
  if (previewHiddenLeft && !app.classList.contains('reading-mode')) return;
  if (previewTimeout) clearTimeout(previewTimeout);
  if (!immediate) {
    previewTimeout = setTimeout(() => updatePreview(true), 150);
    return;
  }
  previewTimeout = null;
  const content = editor.value;
  preview.innerHTML = marked.parse(normalizePreviewMarkdown(content));
  bindPreviewTaskCheckboxes(preview, editor);
  resolvePreviewImages(preview, currentNote);
}

function resolvePreviewImages(container, note) {
  if (!note) return;
  container.querySelectorAll('img').forEach(image => {
    const source = image.getAttribute('src');
    if (!source || /^(?:[a-z]+:|#|\/\/)/i.test(source)) return;
    try {
      const imagePath = path.resolve(path.dirname(note.path), decodeURI(source));
      image.src = pathToFileURL(imagePath).href;
    } catch (err) {
      image.alt = `${image.alt || '图片'}（路径无效）`;
    }
  });
}

function getImageUrl(source, note) {
  if (/^(?:https?:|data:|file:|\/\/)/i.test(source)) return source;
  return pathToFileURL(path.resolve(path.dirname(note.path), decodeURI(source))).href;
}

function parseMarkdownTableRow(line) {
  let value = line.trim();
  if (!value.includes('|')) return null;
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function getTableAlignments(line) {
  const cells = parseMarkdownTableRow(line);
  if (!cells || !cells.length) return null;
  if (!cells.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return cells.map(cell => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });
}

function serializeMarkdownTable(rows, alignments) {
  const escapeCell = cell => String(cell).replace(/\|/g, '\\|');
  const formatRow = row => `| ${row.map(escapeCell).join(' | ')} |`;
  const separator = alignments.map(alignment => {
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
  });
  return [formatRow(rows[0]), formatRow(separator), ...rows.slice(1).map(formatRow)].join('\n');
}

function placeCaretInTableCell(cell, clientX, clientY) {
  const selection = window.getSelection();
  if (!selection) return;
  let range = document.caretRangeFromPoint?.(clientX, clientY) || null;
  if (!range || !cell.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusEditableAtStart(element) {
  if (!element || !element.isConnected) return false;
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function createEditorTableWidget(
  rows,
  alignments,
  onAddColumn,
  onAddRow,
  onContextMenu,
  onCommit
) {
  const widget = document.createElement('span');
  widget.className = 'cm-table-widget';
  widget.title = '表格预览';
  widget.style.setProperty('--cm-table-source-lines', rows.length + 1);
  const viewport = document.createElement('span');
  viewport.className = 'cm-table-viewport';
  const table = document.createElement('table');

  rows.forEach((row, rowIndex) => {
    const section = rowIndex === 0 ? table.createTHead() : table.tBodies[0] || table.createTBody();
    const tableRow = section.insertRow();
    row.forEach((content, columnIndex) => {
      const cell = rowIndex === 0
        ? document.createElement('th')
        : document.createElement('td');
      cell.textContent = content;
      cell.contentEditable = 'plaintext-only';
      cell.spellcheck = false;
      cell.style.textAlign = alignments[columnIndex] || 'left';
      cell.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        cell.focus();
        placeCaretInTableCell(cell, event.clientX, event.clientY);
      });
      cell.addEventListener('click', event => {
        event.stopPropagation();
      });
      cell.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          cell.blur();
        }
      });
      cell.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(rowIndex, columnIndex);
      });
      tableRow.appendChild(cell);
    });
  });

  const addColumnButton = document.createElement('button');
  addColumnButton.className = 'cm-table-add cm-table-add-column';
  addColumnButton.type = 'button';
  addColumnButton.title = '添加列';
  addColumnButton.setAttribute('aria-label', '添加列');
  addColumnButton.textContent = '+';
  addColumnButton.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    onAddColumn();
  });

  const addRowButton = document.createElement('button');
  addRowButton.className = 'cm-table-add cm-table-add-row';
  addRowButton.type = 'button';
  addRowButton.title = '添加行';
  addRowButton.setAttribute('aria-label', '添加行');
  addRowButton.textContent = '+';
  addRowButton.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    onAddRow();
  });

  viewport.appendChild(table);
  widget.append(viewport, addColumnButton, addRowButton);
  widget.addEventListener('mousemove', event => {
    if (event.target === addColumnButton) {
      widget.classList.add('show-add-column');
      widget.classList.remove('show-add-row');
      return;
    }
    if (event.target === addRowButton) {
      widget.classList.add('show-add-row');
      widget.classList.remove('show-add-column');
      return;
    }

    const control = getTableAddControlState(
      widget.getBoundingClientRect(),
      event.clientX,
      event.clientY
    );
    widget.classList.toggle('show-add-column', control?.type === 'column');
    widget.classList.toggle('show-add-row', control?.type === 'row');
  });
  widget.addEventListener('mouseleave', () => {
    widget.classList.remove('show-add-column', 'show-add-row');
  });
  widget.addEventListener('focusout', () => {
    setTimeout(() => {
      if (widget.contains(document.activeElement)) return;
      const nextRows = Array.from(table.rows).map(tableRow => {
        return Array.from(tableRow.cells).map(cell => {
          return (cell.textContent || '').replace(/\s*\n\s*/g, ' ').trim();
        });
      });
      if (JSON.stringify(nextRows) !== JSON.stringify(rows)) onCommit(nextRows);
    }, 0);
  });
  return widget;
}

const commonHighlightLanguages = [
  'javascript', 'typescript', 'python', 'json', 'yaml', 'xml', 'css', 'sql',
  'bash', 'shell', 'markdown', 'java', 'c', 'cpp', 'csharp', 'go', 'rust',
  'swift', 'kotlin', 'php', 'ruby', 'dockerfile', 'ini', 'toml'
];

const highlightLanguageAliases = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  yml: 'yaml',
  html: 'xml',
  svg: 'xml',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  md: 'markdown',
  cs: 'csharp',
  'c++': 'cpp',
  rs: 'rust',
  kt: 'kotlin',
  rb: 'ruby',
  docker: 'dockerfile',
  conf: 'ini'
};

function createEditorCodeWidget(code, requestedLanguage, onCommit) {
  const widget = document.createElement('span');
  widget.className = 'cm-code-widget';
  widget.title = '代码块预览';
  widget.tabIndex = 0;
  const pre = document.createElement('pre');
  const codeElement = document.createElement('code');
  const normalizedLanguage = String(requestedLanguage || '').trim().toLowerCase();
  const language = highlightLanguageAliases[normalizedLanguage] || normalizedLanguage;
  let highlighted;

  if (language && hljs.getLanguage(language)) {
    highlighted = hljs.highlight(code, { language });
  } else {
    const availableLanguages = commonHighlightLanguages.filter(item => hljs.getLanguage(item));
    highlighted = hljs.highlightAuto(code, availableLanguages);
  }

  codeElement.className = 'hljs';
  codeElement.innerHTML = highlighted.value;
  codeElement.contentEditable = 'plaintext-only';
  codeElement.spellcheck = false;
  codeElement.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    codeElement.focus();
    placeCaretInTableCell(codeElement, event.clientX, event.clientY);
  });
  codeElement.addEventListener('click', event => event.stopPropagation());
  pre.appendChild(codeElement);
  widget.appendChild(pre);

  const languageLabel = language && hljs.getLanguage(language)
    ? normalizedLanguage || language
    : highlighted.language;
  if (languageLabel) {
    const badge = document.createElement('span');
    badge.className = 'cm-code-language';
    badge.textContent = languageLabel;
    widget.appendChild(badge);
  }
  codeElement.addEventListener('focusout', () => {
    setTimeout(() => {
      if (widget.contains(document.activeElement)) return;
      const nextCode = (codeElement.innerText || codeElement.textContent || '')
        .replace(/\r/g, '')
        .replace(/\n$/, '');
      if (nextCode !== code) onCommit(nextCode);
    }, 0);
  });
  return widget;
}

function getCachedCodeBlocks(editorAdapter) {
  if (!editorAdapter.decorationStructureDirty) return editorAdapter.codeBlocks;
  const codeMirror = editorAdapter.codeMirror;
  const lines = Array.from(
    { length: codeMirror.lineCount() },
    (_, line) => codeMirror.getLine(line)
  );
  const blocks = getFencedCodeBlocks(lines);

  editorAdapter.codeBlocks = blocks;
  editorAdapter.decorationStructureDirty = false;
  return blocks;
}

function renderEditorDecorations(editorAdapter, note) {
  if (editorAdapter.renderingDecorations) return;
  editorAdapter.renderingDecorations = true;
  const codeMirror = editorAdapter.codeMirror;
  const wrapper = codeMirror.getWrapperElement();
  try {
  codeMirror.operation(() => {
    editorAdapter.decorationMarks.forEach(mark => mark.clear());
    editorAdapter.decorationMarks = [];
    editorAdapter.decorationLines.forEach(item => {
      codeMirror.removeLineClass(item.line, 'wrap', item.className);
    });
    editorAdapter.decorationLines = [];
    editorAdapter.decorationWidgets.forEach(widget => widget.clear());
    editorAdapter.decorationWidgets = [];
  });
  if (!note) {
    wrapper.style.removeProperty('--editor-cursor-height');
    wrapper.style.removeProperty('--editor-cursor-offset');
    return;
  }

  const activeLine = codeMirror.getCursor().line;
  const viewport = codeMirror.getViewport();
  const firstLine = Math.max(0, viewport.from - 20);
  const lastLine = Math.min(codeMirror.lineCount(), viewport.to + 20);
  const documentLines = Array.from(
    { length: codeMirror.lineCount() },
    (_, line) => codeMirror.getLine(line)
  );
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const codeBlocks = getCachedCodeBlocks(editorAdapter);

  function addMark(from, to, options) {
    const mark = codeMirror.markText(from, to, options);
    editorAdapter.decorationMarks.push(mark);
    return mark;
  }

  function addBookmark(position, options) {
    const mark = codeMirror.setBookmark(position, options);
    editorAdapter.decorationMarks.push(mark);
    return mark;
  }

  function addLineStyle(lineNumber, className) {
    const line = codeMirror.addLineClass(lineNumber, 'wrap', className);
    editorAdapter.decorationLines.push({ line, className });
  }

  function createImageWidget(match, notifyHeightChange) {
    const widget = document.createElement('span');
    widget.className = 'cm-image-widget';
    widget.title = '选中图片';
    const image = document.createElement('img');
    image.alt = match[1] || '图片';
    image.addEventListener('load', notifyHeightChange);
    image.addEventListener('error', notifyHeightChange);
    try {
      image.src = getImageUrl(match[2], note);
    } catch (err) {
      widget.classList.add('is-broken');
    }
    widget.appendChild(image);
    const linkIndicator = document.createElement('span');
    linkIndicator.className = 'cm-image-link-indicator';
    linkIndicator.title = '图片包含链接';
    linkIndicator.innerHTML = '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>';
    widget.appendChild(linkIndicator);
    widget.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      wrapper.querySelectorAll('.cm-image-widget.is-selected').forEach(selected => {
        if (selected !== widget) selected.classList.remove('is-selected');
      });
      widget.classList.toggle('is-selected');
    });
    return widget;
  }

  function createTaskCheckbox(listPrefix, lineNumber) {
    const checkbox = document.createElement('span');
    checkbox.className = 'cm-rendered-checkbox';
    checkbox.classList.toggle('is-checked', listPrefix.checked);
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute('aria-checked', String(listPrefix.checked));
    checkbox.setAttribute('aria-label', listPrefix.checked ? '标记为未完成' : '标记为已完成');
    checkbox.title = listPrefix.checked ? '标记为未完成' : '标记为已完成';
    checkbox.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      const from = { line: lineNumber, ch: listPrefix.toggleCh };
      const to = { line: lineNumber, ch: listPrefix.toggleCh + 1 };
      codeMirror.replaceRange(listPrefix.checked ? ' ' : 'x', from, to, 'task-toggle');
      codeMirror.focus();
    });
    return checkbox;
  }

  Array.from(editorAdapter.collapsedHeadings).forEach(lineHandle => {
    const headingLine = codeMirror.getLineNumber(lineHandle);
    if (headingLine === null) {
      editorAdapter.collapsedHeadings.delete(lineHandle);
      return;
    }
    const section = getHeadingSectionRange(documentLines, headingLine);
    if (!section || section.startLine > section.endLine) return;
    addMark(
      { line: section.startLine, ch: 0 },
      { line: section.endLine, ch: codeMirror.getLine(section.endLine).length },
      { collapsed: true }
    );
  });

  function hideDelimiters(lineNumber, match, openLength, closeStart, className) {
    addMark(
      { line: lineNumber, ch: match.index },
      { line: lineNumber, ch: match.index + openLength },
      { collapsed: true }
    );
    addMark(
      { line: lineNumber, ch: match.index + openLength },
      { line: lineNumber, ch: match.index + closeStart },
      { className }
    );
    addMark(
      { line: lineNumber, ch: match.index + closeStart },
      { line: lineNumber, ch: match.index + match[0].length },
      { collapsed: true }
    );
  }

  codeMirror.operation(() => {
    const renderedTableLines = new Set();
    const renderedCodeLines = new Set();
    const fencedLines = new Set();
    codeBlocks.forEach(block => {
      const rangeStart = Math.max(block.start, firstLine);
      const rangeEnd = Math.min(block.end, lastLine - 1);
      for (let lineNumber = rangeStart; lineNumber <= rangeEnd; lineNumber += 1) {
        fencedLines.add(lineNumber);
      }
    });

    codeBlocks.forEach(block => {
      if (!block.closed) return;
      if (block.end < firstLine || block.start >= lastLine) return;
      if (block.end - block.start > 400) return;
      const code = codeMirror.getRange(
        { line: block.start + 1, ch: 0 },
        { line: block.end, ch: 0 }
      ).replace(/\n$/, '');
      const from = { line: block.start, ch: 0 };
      const to = { line: block.end, ch: codeMirror.getLine(block.end).length };
      let codeMark;
      const widget = createEditorCodeWidget(code, block.language, nextCode => {
        if (codeMark) codeMark.clear();
        const safeLanguage = String(block.language || '').replace(/[^\w+-]/g, '');
        const fence = `\`\`\`${safeLanguage}\n${nextCode}\n\`\`\``;
        codeMirror.replaceRange(fence, from, to);
        scheduleEditorDecorations(editorAdapter, () => note);
      });
      codeMark = addMark(from, to, {
        replacedWith: widget,
        atomic: true,
        handleMouseEvents: true
      });
      scheduleDecorationHeightChange(() => {
        return editorAdapter.decorationMarks.includes(codeMark) ? codeMark : null;
      }, codeMirror);
      if (
        pendingCodeFocusEditor?.editor === editorAdapter
        && pendingCodeFocusEditor.line === block.start
      ) {
        const focusCodeEditor = () => {
          if (
            pendingCodeFocusEditor?.editor !== editorAdapter
            || pendingCodeFocusEditor.line !== block.start
          ) return;
          const codeElement = widget.querySelector('code[contenteditable]');
          if (!focusEditableAtStart(codeElement)) return;
          setTimeout(() => {
            if (
              pendingCodeFocusEditor?.editor === editorAdapter
              && pendingCodeFocusEditor.line === block.start
              && codeElement.isConnected
              && document.activeElement === codeElement
            ) {
              pendingCodeFocusEditor = null;
            }
          }, 220);
        };
        queueMicrotask(focusCodeEditor);
        requestAnimationFrame(focusCodeEditor);
        setTimeout(focusCodeEditor, 50);
      }
      widget.addEventListener('mousedown', event => {
        if (event.target.closest('code')) return;
        event.preventDefault();
        widget.focus();
      });
      const visibleStart = Math.max(block.start, firstLine);
      const visibleEnd = Math.min(block.end, lastLine - 1);
      for (let codeLine = visibleStart; codeLine <= visibleEnd; codeLine += 1) {
        renderedCodeLines.add(codeLine);
      }
    });

    for (let lineNumber = firstLine; lineNumber < lastLine - 1; lineNumber += 1) {
      if (
        fencedLines.has(lineNumber)
        || renderedTableLines.has(lineNumber)
        || renderedCodeLines.has(lineNumber)
      ) continue;
      const header = parseMarkdownTableRow(codeMirror.getLine(lineNumber));
      const alignments = getTableAlignments(codeMirror.getLine(lineNumber + 1));
      if (!header || !alignments || header.length !== alignments.length) continue;

      const rows = [header];
      let endLine = lineNumber + 1;
      let tableTooLarge = false;
      while (endLine + 1 < codeMirror.lineCount()) {
        const row = parseMarkdownTableRow(codeMirror.getLine(endLine + 1));
        if (!row || row.length !== header.length || fencedLines.has(endLine + 1)) break;
        if (rows.length >= 200) {
          tableTooLarge = true;
          break;
        }
        rows.push(row);
        endLine += 1;
      }
      if (tableTooLarge) {
        lineNumber = endLine;
        continue;
      }
      const from = { line: lineNumber, ch: 0 };
      const to = { line: endLine, ch: codeMirror.getLine(endLine).length };
      let tableMark;
      const replaceTable = (nextRows, nextAlignments) => {
        if (tableMark) tableMark.clear();
        codeMirror.replaceRange(
          serializeMarkdownTable(nextRows, nextAlignments),
          from,
          to
        );
        scheduleEditorDecorations(editorAdapter, () => note);
      };
      const widget = createEditorTableWidget(
        rows,
        alignments,
        () => {
          const nextRows = rows.map(row => [...row, '']);
          replaceTable(nextRows, [...alignments, 'left']);
        },
        () => {
          const nextRows = [...rows, Array(header.length).fill('')];
          replaceTable(nextRows, alignments);
        },
        (rowIndex, columnIndex) => {
          tableContextActionHandler = action => {
            const nextRows = rows.map(row => [...row]);
            const nextAlignments = [...alignments];
            if (action === 'add-row') {
              nextRows.splice(rowIndex + 1, 0, Array(header.length).fill(''));
            } else if (action === 'delete-row' && rowIndex > 0) {
              nextRows.splice(rowIndex, 1);
            } else if (action === 'add-column') {
              nextRows.forEach(row => row.splice(columnIndex + 1, 0, ''));
              nextAlignments.splice(columnIndex + 1, 0, 'left');
            } else if (action === 'delete-column' && header.length > 1) {
              nextRows.forEach(row => row.splice(columnIndex, 1));
              nextAlignments.splice(columnIndex, 1);
            } else {
              return;
            }
            replaceTable(nextRows, nextAlignments);
          };
          ipcRenderer.send('show-table-context-menu', {
            rowIndex,
            columnIndex,
            columnCount: header.length
          });
        },
        nextRows => {
          replaceTable(nextRows, alignments);
        }
      );
      tableMark = addMark(from, to, {
        replacedWith: widget,
        atomic: true,
        handleMouseEvents: true
      });
      if (
        pendingTableFocusEditor?.editor === editorAdapter
        && codeMirror.posFromIndex(pendingTableFocusEditor.index).line >= lineNumber
        && codeMirror.posFromIndex(pendingTableFocusEditor.index).line <= endLine
      ) {
        requestAnimationFrame(() => {
          const firstCell = widget.querySelector('th, td');
          if (!focusEditableAtStart(firstCell)) return;
          if (pendingTableFocusEditor?.editor === editorAdapter) {
            pendingTableFocusEditor = null;
          }
        });
      }
      widget.addEventListener('mousedown', event => {
        if (event.target.closest('th, td, .cm-table-add')) return;
        event.preventDefault();
      });
      for (let tableLine = lineNumber; tableLine <= endLine; tableLine += 1) {
        renderedTableLines.add(tableLine);
      }
      lineNumber = endLine;
    }

    codeMirror.eachLine(firstLine, lastLine, lineHandle => {
      const lineNumber = codeMirror.getLineNumber(lineHandle);
    const lineText = lineHandle.text;
    if (renderedCodeLines.has(lineNumber)) return;
    if (renderedTableLines.has(lineNumber)) return;
    const containingCodeBlock = codeBlocks.find(block => (
      block.start <= lineNumber && block.end >= lineNumber
    ));
    const fenceLine = Boolean(containingCodeBlock && (
      containingCodeBlock.start === lineNumber
      || (containingCodeBlock.closed && containingCodeBlock.end === lineNumber)
    ));
    const inCodeFence = Boolean(containingCodeBlock && !fenceLine);
    const headingPrefix = !inCodeFence && lineText.match(/^(#{1,6})\s+/);
    if (headingPrefix) {
      const section = getHeadingSectionRange(documentLines, lineNumber);
      if (section && section.startLine <= section.endLine) {
        const collapsed = editorAdapter.collapsedHeadings.has(lineHandle);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `cm-heading-toggle${collapsed ? ' is-collapsed' : ''}`;
        toggle.title = collapsed ? '展开标题内容' : '收起标题内容';
        toggle.setAttribute('aria-label', toggle.title);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.innerHTML = '<svg viewBox="0 0 16 16"><path d="m5 3 5 5-5 5"/></svg>';
        toggle.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
          if (collapsed) editorAdapter.collapsedHeadings.delete(lineHandle);
          else editorAdapter.collapsedHeadings.add(lineHandle);
          codeMirror.setCursor({ line: lineNumber, ch: headingPrefix[0].length });
          codeMirror.focus();
          scheduleEditorDecorations(editorAdapter, () => note);
        });
        addBookmark({ line: lineNumber, ch: 0 }, {
          widget: toggle,
          insertLeft: true,
          handleMouseEvents: true
        });
      }
    }
    if (lineNumber === activeLine) {
      const activeHeading = lineText.match(/^(#{1,6})\s+/);
      const activeQuote = lineText.match(/^\s*>\s+/);
      let editingClassName = 'cm-editing-source-line';
      if (activeHeading) {
        addLineStyle(lineNumber, 'cm-rendered-heading-line');
        addLineStyle(lineNumber, `cm-rendered-heading-line-${activeHeading[1].length}`);
        editingClassName += ` cm-editing-heading cm-rendered-h${activeHeading[1].length}`;
      }
      if (activeQuote) {
        addLineStyle(lineNumber, 'cm-rendered-quote-line');
        editingClassName += ' cm-editing-quote';
        addMark(
          { line: lineNumber, ch: 0 },
          { line: lineNumber, ch: activeQuote[0].length },
          { collapsed: true }
        );
      }
      if (lineText && !inCodeFence && !fenceLine) {
        addMark(
          { line: lineNumber, ch: 0 },
          { line: lineNumber, ch: lineText.length },
          { className: editingClassName }
        );
      }
      let activeImageMatch;
      while ((activeImageMatch = imagePattern.exec(lineText)) !== null) {
        let imageDecoration;
        const widget = createImageWidget(activeImageMatch, () => {
          scheduleDecorationHeightChange(() => {
            return editorAdapter.decorationWidgets.includes(imageDecoration)
              ? imageDecoration
              : null;
          }, codeMirror);
        });
        widget.classList.add('is-source-visible');
        imageDecoration = codeMirror.addLineWidget(lineNumber, widget, {
          above: false,
          coverGutter: false,
          noHScroll: true
        });
        editorAdapter.decorationWidgets.push(imageDecoration);
      }
      imagePattern.lastIndex = 0;
      const activeListPrefix = getRenderedListPrefix(lineText);
      const activeCursor = codeMirror.getCursor();
      const activeListCursorCh = getActiveBulletSourceCursor(
        activeListPrefix,
        activeCursor.ch
      );
      if (activeListCursorCh !== activeCursor.ch) {
        codeMirror.setCursor({ line: activeCursor.line, ch: activeListCursorCh });
      }
      const renderActiveListPrefix = shouldRenderActiveListPrefix(
        activeListPrefix,
        activeListCursorCh
      );
      if (activeListPrefix) addLineStyle(lineNumber, 'cm-rendered-list-line');
      if (renderActiveListPrefix && activeListPrefix.type === 'task') {
        const checkbox = createTaskCheckbox(activeListPrefix, lineNumber);
        addMark(
          { line: lineNumber, ch: activeListPrefix.fromCh },
          { line: lineNumber, ch: activeListPrefix.toCh },
          { replacedWith: checkbox, atomic: true, handleMouseEvents: true }
        );
      } else if (renderActiveListPrefix) {
        const marker = document.createElement('span');
        marker.className = `cm-rendered-list-marker cm-rendered-${activeListPrefix.type}`;
        marker.textContent = activeListPrefix.type === 'ordered'
          ? `${activeListPrefix.label} `
          : activeListPrefix.label;
        addMark(
          { line: lineNumber, ch: activeListPrefix.fromCh },
          { line: lineNumber, ch: activeListPrefix.toCh },
          { replacedWith: marker }
        );
      }
      return;
    }

    if (fenceLine) {
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: lineText.length },
        { collapsed: true }
      );
      return;
    }
    if (inCodeFence) {
      addLineStyle(lineNumber, 'cm-rendered-code-line');
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: lineText.length },
        { className: 'cm-rendered-code-block' }
      );
      return;
    }

    let match;
    let hasImage = false;
    while ((match = imagePattern.exec(lineText)) !== null) {
      hasImage = true;
      let imageDecoration;
      const widget = createImageWidget(match, () => {
        scheduleDecorationHeightChange(() => {
          return editorAdapter.decorationMarks.includes(imageDecoration)
            ? imageDecoration
            : null;
        }, codeMirror);
      });

      const from = { line: lineNumber, ch: match.index };
      const to = { line: lineNumber, ch: match.index + match[0].length };
      imageDecoration = addMark(from, to, {
        replacedWith: widget,
        atomic: true,
        handleMouseEvents: true
      });
    }
    imagePattern.lastIndex = 0;
    if (hasImage) return;

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lineText)) {
      const rule = document.createElement('span');
      rule.className = 'cm-rendered-rule';
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: lineText.length },
        { replacedWith: rule }
      );
      return;
    }

    if (lineText.trim()) {
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: lineText.length },
        { className: 'cm-rendered-text' }
      );
    }

    const heading = lineText.match(/^(#{1,6})\s+/);
    if (heading) {
      addLineStyle(lineNumber, 'cm-rendered-heading-line');
      addLineStyle(lineNumber, `cm-rendered-heading-line-${heading[1].length}`);
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: heading[0].length },
        { collapsed: true }
      );
      addMark(
        { line: lineNumber, ch: heading[0].length },
        { line: lineNumber, ch: lineText.length },
        { className: `cm-rendered-heading cm-rendered-h${heading[1].length}` }
      );
    }

    const quote = lineText.match(/^\s*>\s?/);
    if (quote) {
      addLineStyle(lineNumber, 'cm-rendered-quote-line');
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: quote[0].length },
        { collapsed: true }
      );
      addMark(
        { line: lineNumber, ch: quote[0].length },
        { line: lineNumber, ch: lineText.length },
        { className: 'cm-rendered-quote' }
      );
    }

    const listPrefix = getRenderedListPrefix(lineText);
    if (listPrefix) addLineStyle(lineNumber, 'cm-rendered-list-line');
    if (listPrefix?.type === 'task') {
      const checkbox = createTaskCheckbox(listPrefix, lineNumber);
      addMark(
        { line: lineNumber, ch: listPrefix.fromCh },
        { line: lineNumber, ch: listPrefix.toCh },
        { replacedWith: checkbox, atomic: true, handleMouseEvents: true }
      );
    } else if (listPrefix) {
      const marker = document.createElement('span');
      marker.className = `cm-rendered-list-marker cm-rendered-${listPrefix.type}`;
      marker.textContent = listPrefix.type === 'ordered'
        ? `${listPrefix.label} `
        : listPrefix.label;
      addMark(
        { line: lineNumber, ch: listPrefix.fromCh },
        { line: lineNumber, ch: listPrefix.toCh },
        { replacedWith: marker }
      );
    }

    const patterns = [
      { regex: /\*\*([^*]+)\*\*/g, open: 2, close: 2, className: 'cm-rendered-strong' },
      { regex: /~~([^~]+)~~/g, open: 2, close: 2, className: 'cm-rendered-strike' },
      { regex: /==([^=]+)==/g, open: 2, close: 2, className: 'cm-rendered-highlight' },
      { regex: /`([^`]+)`/g, open: 1, close: 1, className: 'cm-rendered-code' },
      { regex: /(?<!\*)\*([^*]+)\*(?!\*)/g, open: 1, close: 1, className: 'cm-rendered-em' }
    ];
    patterns.forEach(pattern => {
      while ((match = pattern.regex.exec(lineText)) !== null) {
        hideDelimiters(
          lineNumber,
          match,
          pattern.open,
          match[0].length - pattern.close,
          pattern.className
        );
      }
    });

    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = linkPattern.exec(lineText)) !== null) {
      hideDelimiters(lineNumber, match, 1, match[1].length + 1, 'cm-rendered-link');
    }
    });
  });
  } finally {
    editorAdapter.renderingDecorations = false;
    if (editorAdapter.cursorAlignmentFrame) {
      cancelAnimationFrame(editorAdapter.cursorAlignmentFrame);
    }
    editorAdapter.cursorAlignmentFrame = requestAnimationFrame(() => {
      editorAdapter.cursorAlignmentFrame = null;
      const cursor = wrapper.querySelector('.CodeMirror-cursor');
      if (!cursor) return;
      const cursorPosition = codeMirror.cursorCoords(null, 'window');
      const cursorRect = {
        top: cursorPosition.top,
        height: cursorPosition.bottom - cursorPosition.top
      };
      const activeTextRects = Array.from(
        wrapper.querySelectorAll('.cm-editing-source-line')
      ).flatMap(element => Array.from(element.getClientRects()));
      const textRect = getCurrentLineTextRect(
        cursorRect,
        activeTextRects
      ) || getFallbackTextRect(
        cursorRect,
        Number.parseFloat(getComputedStyle(wrapper).fontSize)
      );
      const alignment = getEditorCursorAlignment(
        cursorRect,
        textRect
      );
      if (!alignment) return;
      wrapper.style.setProperty('--editor-cursor-height', `${alignment.height}px`);
      wrapper.style.setProperty('--editor-cursor-offset', `${alignment.offset}px`);
    });
  }
}

function createFencedCodeBlock(code, language = '') {
  const normalizedCode = normalizeClipboardText(code);
  const backtickRuns = normalizedCode.match(/`+/g) || [];
  const fenceLength = Math.max(3, ...backtickRuns.map(run => run.length + 1));
  const fence = '`'.repeat(fenceLength);
  const safeLanguage = String(language || '').replace(/[^\w+-]/g, '');
  const closingBreak = normalizedCode.endsWith('\n') ? '' : '\n';
  return `\n${fence}${safeLanguage}\n${normalizedCode}${closingBreak}${fence}\n`;
}

function getClipboardEditorCode(event, html, text) {
  const clipboardData = event.clipboardData;
  if (!clipboardData || !text) return '';

  try {
    const vscodeData = clipboardData.getData('vscode-editor-data');
    if (vscodeData) {
      const metadata = JSON.parse(vscodeData);
      return createFencedCodeBlock(text, metadata.mode || '');
    }
  } catch (err) {
    // Ignore malformed editor metadata and continue with HTML detection.
  }

  const hasMonospaceStyle = /font-family\s*:[^;]*(?:monospace|menlo|monaco|consolas|courier)/i
    .test(html);
  const hasEditorMarkup = /<(?:div|span)\b[^>]*style=/i.test(html);
  if (hasMonospaceStyle && hasEditorMarkup) {
    const languageMatch = html.match(/(?:language-|data-language=["'])([\w+-]+)/i);
    return createFencedCodeBlock(text, languageMatch?.[1] || '');
  }
  return '';
}

function clipboardHtmlToMarkdown(html, relativePaths) {
  if (!html) return '';
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('script, style, meta, link').forEach(node => node.remove());
  let imageIndex = 0;

  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') {
      const relativePath = relativePaths[imageIndex++];
      return relativePath ? `\n\n![图片](${relativePath})\n\n` : '';
    }
    if (tag === 'br') return '\n';
    if (
      ['ul', 'ol'].includes(tag)
      && /(?:code[-_]?snippet.*line[-_]?index|line[-_]?numbers?)/i.test(node.className || '')
    ) {
      return '';
    }
    if (tag === 'pre') {
      const directCodeNodes = Array.from(node.querySelectorAll(':scope > code'));
      const codeNode = directCodeNodes[0] || node.querySelector('code');
      const code = directCodeNodes.length > 1
        ? directCodeNodes.map(line => line.textContent || '').join('\n')
        : (codeNode || node).textContent || '';
      const languageMatch = `${node.className || ''} ${codeNode?.className || ''}`
        .match(/(?:^|\s)language-([\w+-]+)/);
      const language = node.getAttribute('data-lang')
        || node.getAttribute('data-language')
        || languageMatch?.[1]
        || '';
      return createFencedCodeBlock(
        code,
        language
      );
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map(row => {
        return Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(cell => {
          return normalizeClipboardText(cell.textContent || '').replace(/\n/g, '<br>');
        });
      }).filter(row => row.length > 0);
      if (!rows.length) return '';
      const columnCount = Math.max(...rows.map(row => row.length));
      const normalizedRows = rows.map(row => {
        return [...row, ...Array(columnCount - row.length).fill('')];
      });
      return `\n${serializeMarkdownTable(normalizedRows, Array(columnCount).fill('left'))}\n`;
    }
    const content = Array.from(node.childNodes).map(convert).join('');
    if (/^h[1-6]$/.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${content}\n`;
    if (tag === 'li') return content.trim() ? `\n- ${content}` : '';
    if (tag === 'blockquote') {
      return `\n${content.split('\n').map(line => `> ${line}`).join('\n')}\n`;
    }
    if (['p', 'div', 'section', 'article', 'ul', 'ol'].includes(tag)) return `\n${content}\n`;
    if (tag === 'strong' || tag === 'b') return `**${content}**`;
    if (tag === 'em' || tag === 'i') return `*${content}*`;
    if (tag === 'code') {
      const delimiter = content.includes('`') ? '``' : '`';
      return `${delimiter}${content}${delimiter}`;
    }
    if (tag === 'a') return `[${content}](${node.getAttribute('href') || ''})`;
    return content;
  }

  return removeGeneratedBoundaryNewlines(convert(documentNode.body));
}

function clipboardHtmlToFormattedText(html, text) {
  const normalizedText = normalizeClipboardText(text);
  if (!html || !normalizedText) return normalizedText;
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const marks = [];
  let searchFrom = 0;
  const formats = [
    { selector: 'strong, b', open: '**', close: '**' },
    { selector: 'em, i', open: '*', close: '*' }
  ];

  formats.forEach(format => {
    documentNode.querySelectorAll(format.selector).forEach(node => {
      const content = normalizeClipboardText(node.textContent || '');
      if (!content) return;
      let start = normalizedText.indexOf(content, searchFrom);
      if (start < 0) start = normalizedText.indexOf(content);
      if (start < 0) return;
      marks.push({
        start,
        end: start + content.length,
        open: format.open,
        close: format.close
      });
      searchFrom = start + content.length;
    });
  });

  return applyClipboardMarkdownMarks(normalizedText, marks);
}

function clipboardTextTableToMarkdown(text) {
  const lines = normalizeClipboardText(text).split('\n');
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length || !lines.some(line => line.includes('\t'))) return '';
  const rows = lines.map(line => line.split('\t'));
  const columnCount = Math.max(...rows.map(row => row.length));
  if (columnCount < 2) return '';
  const normalizedRows = rows.map(row => {
    return [...row, ...Array(columnCount - row.length).fill('')];
  });
  return serializeMarkdownTable(normalizedRows, Array(columnCount).fill('left'));
}

async function pasteImages(event, editorElement, getCurrentNote) {
  event.preventDefault();
  const clipboardText = event.clipboardData?.getData('text/plain') || '';
  const clipboardHtml = event.clipboardData?.getData('text/html') || '';
  const note = getCurrentNote();
  const result = await ipcRenderer.invoke('paste-clipboard-content', {
    notePath: note?.path || null
  });
  if (!result.success) {
    showConfirm('粘贴失败', result.error, () => {});
    return;
  }

  const start = editorElement.selectionStart;
  const end = editorElement.selectionEnd;
  let pastedContent;
  if (result.hasImage) {
    const needsLeadingBreak = start > 0 && editorElement.value[start - 1] !== '\n';
    const needsTrailingBreak = end < editorElement.value.length && editorElement.value[end] !== '\n';
    const imageMarkdown = result.relativePaths.map(relativePath => {
      return `![图片](${relativePath})`;
    }).join('\n\n');
    const htmlContent = clipboardHtmlToMarkdown(result.html, result.relativePaths);
    const text = normalizeClipboardText(result.text || clipboardText);
    const clipboardContent = htmlContent
      || joinClipboardTextAndImages(text, imageMarkdown);
    pastedContent = `${needsLeadingBreak ? '\n' : ''}${clipboardContent}${needsTrailingBreak ? '\n' : ''}`;
  } else {
    const htmlSource = clipboardHtml || result.html || '';
    const text = normalizeClipboardText(result.text || clipboardText);
    const editorCode = getClipboardEditorCode(event, htmlSource, text);
    const htmlBlock = /<(?:table|pre)[\s>]/i.test(htmlSource)
      ? clipboardHtmlToMarkdown(htmlSource, [])
      : '';
    const formattedText = shouldConvertClipboardHtml(htmlSource)
      ? clipboardHtmlToFormattedText(htmlSource, text)
      : text;
    const optimizedText = optimizeClipboardPlainText(formattedText);
    const textTable = clipboardTextTableToMarkdown(text);
    const structuredContent = htmlBlock || editorCode || textTable;
    if (structuredContent) {
      const needsLeadingBreak = start > 0 && editorElement.value[start - 1] !== '\n';
      const needsTrailingBreak = end < editorElement.value.length
        && editorElement.value[end] !== '\n';
      pastedContent = `${needsLeadingBreak ? '\n\n' : ''}${structuredContent}`
        + `${needsTrailingBreak ? '\n\n' : ''}`;
    } else {
      pastedContent = optimizedText;
    }
  }
  editorElement.setRangeText(pastedContent, start, end, 'end');
  editorElement.dispatchEvent(new Event('input', { bubbles: true }));
}

async function saveCurrentNote() {
  if (!currentNote) return;

  const newName = noteTitle.value.trim() || 'untitled';
  const content = editor.value;
  
  const renamed = newName !== currentNote.name;
  if (renamed) {
    const result = await ipcRenderer.invoke('rename-note', {
      oldPath: currentNote.path,
      newName: newName
    });
    currentNote = result;
  }

  await ipcRenderer.invoke('save-note', {
    notePath: currentNote.path,
    content: content
  });

  if (renamed) await loadTree();
}

async function exportCurrentNoteToPdf() {
  if (!currentNote) {
    showConfirm('无法导出', '请先选择要导出的笔记', () => {});
    return;
  }

  await saveCurrentNote();
  const wasReadingMode = app.classList.contains('reading-mode');
  app.classList.add('reading-mode', 'exporting-pdf');
  updatePreview(true);

  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = await ipcRenderer.invoke('export-current-pdf', currentNote.name);
    if (!result.success && !result.canceled) {
      showConfirm('导出失败', result.error || '无法生成 PDF 文件', () => {});
    }
  } finally {
    app.classList.remove('exporting-pdf');
    if (!wasReadingMode) app.classList.remove('reading-mode');
  }
}

function insertMarkdownTable() {
  const useRightEditor = lastActiveEditor === editorRight && currentNoteRight;
  const targetEditor = useRightEditor ? editorRight : editor;
  const targetNote = useRightEditor ? currentNoteRight : currentNote;
  if (!targetNote) {
    showConfirm('无法插入表格', '请先选择一篇笔记', () => {});
    return;
  }

  const start = targetEditor.selectionStart;
  const end = targetEditor.selectionEnd;
  const before = targetEditor.value.slice(0, start);
  const after = targetEditor.value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
  const table = '|  |  |\n| --- | --- |\n|  |  |';
  const insertion = `${prefix}${table}${suffix}`;

  pendingTableFocusEditor = {
    editor: targetEditor,
    index: start + prefix.length + 2
  };
  targetEditor.setRangeText(insertion, start, end);
  targetEditor.setCursorIndex(start + prefix.length + 2);
  targetEditor.focus();
}

function insertMarkdownCodeFence() {
  const useRightEditor = lastActiveEditor === editorRight && currentNoteRight;
  const targetEditor = useRightEditor ? editorRight : editor;
  const targetNote = useRightEditor ? currentNoteRight : currentNote;
  if (!targetNote) {
    showConfirm('无法插入代码块', '请先选择一篇笔记', () => {});
    return;
  }

  const start = targetEditor.selectionStart;
  const end = targetEditor.selectionEnd;
  targetEditor.setRangeText('```', start, end);
  targetEditor.setCursorIndex(start + 3);
  targetEditor.focus();
}

function hideTemplateDialog() {
  templateModal.classList.remove('active');
  templateList.replaceChildren();
  templateError.textContent = '';
}

async function insertTemplateContent(fileName) {
  const useRightEditor = lastActiveEditor === editorRight && currentNoteRight;
  const targetEditor = useRightEditor ? editorRight : editor;
  const targetNote = useRightEditor ? currentNoteRight : currentNote;
  if (!targetNote) {
    hideTemplateDialog();
    showConfirm('无法插入模板', '请先选择一篇笔记', () => {});
    return;
  }

  const result = await ipcRenderer.invoke('read-template', fileName);
  if (!result.success) {
    templateError.textContent = result.error || '模板读取失败';
    return;
  }
  const start = targetEditor.selectionStart;
  targetEditor.setRangeText(result.content, start, targetEditor.selectionEnd);
  targetEditor.setCursorIndex(start + result.content.length);
  targetEditor.focus();
  hideTemplateDialog();
}

async function showTemplateDialog() {
  const targetNote = lastActiveEditor === editorRight ? currentNoteRight : currentNote;
  if (!targetNote) {
    showConfirm('无法插入模板', '请先选择一篇笔记', () => {});
    return;
  }
  templateList.replaceChildren();
  templateError.textContent = '';
  templateModal.classList.add('active');

  const result = await ipcRenderer.invoke('get-templates');
  if (!result.success) {
    templateError.textContent = result.error || '模板列表加载失败，请先在设置中选择模板目录';
    return;
  }
  if (!result.templates.length) {
    const empty = document.createElement('div');
    empty.className = 'template-empty';
    empty.textContent = '模板目录中没有 Markdown 模板';
    templateList.appendChild(empty);
    return;
  }
  result.templates.forEach(template => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = template.name;
    button.addEventListener('click', () => insertTemplateContent(template.file));
    templateList.appendChild(button);
  });
  templateList.querySelector('button')?.focus();
}

function formatActiveMarkdown(format) {
  const useRightEditor = lastActiveEditor === editorRight && currentNoteRight;
  const targetEditor = useRightEditor ? editorRight : editor;
  const targetNote = useRightEditor ? currentNoteRight : currentNote;
  if (!targetNote) return;
  const edit = getMarkdownFormatEdit(
    targetEditor.value,
    targetEditor.selectionStart,
    targetEditor.selectionEnd,
    format
  );
  if (!edit) return;
  const codeMirror = targetEditor.codeMirror;
  codeMirror.operation(() => {
    codeMirror.replaceRange(
      edit.text,
      codeMirror.posFromIndex(edit.from),
      codeMirror.posFromIndex(edit.to),
      'format-markdown'
    );
    codeMirror.setSelection(
      codeMirror.posFromIndex(edit.selectionStart),
      codeMirror.posFromIndex(edit.selectionEnd)
    );
  });
  targetEditor.focus();
}

async function createNewNote(folderPath = null) {
  showModal('新建笔记', '请输入笔记名称', '', async (name) => {
    if (name) {
      const filePath = await ipcRenderer.invoke('create-note', { name, folderPath });
      currentNote = { name, path: filePath };
      noteTitle.value = name;
      editor.value = '';
      leftPanel.classList.remove('ai-layout-optimized');
      updatePreview(true);
      await loadTree();
    }
  });
}

async function createNewFolder(parentPath = null) {
  showModal('新建文件夹', '请输入文件夹名称', '', async (name) => {
    if (name) {
      await ipcRenderer.invoke('create-folder', { name, parentPath });
      await loadTree();
    }
  });
}

async function renameItem(data) {
  const title = data.type === 'folder' ? '重命名文件夹' : '重命名笔记';
  showModal(title, '请输入新名称', data.name, async (newName) => {
    if (newName && newName !== data.name) {
      if (data.type === 'folder') {
        await ipcRenderer.invoke('rename-folder', {
          oldPath: data.path,
          newName: newName
        });
      } else {
        const result = await ipcRenderer.invoke('rename-note', {
          oldPath: data.path,
          newName: newName
        });
        if (currentNote && currentNote.path === data.path) {
          currentNote = result;
          noteTitle.value = result.name;
        }
      }
      await loadTree();
    }
  });
}

async function deleteItem(data) {
  const typeName = data.type === 'folder' ? '文件夹' : '笔记';
  const message = data.type === 'folder' 
    ? `确定要删除文件夹 "${data.name}" 及其所有内容吗？`
    : `确定要删除笔记 "${data.name}" 吗？`;
  
  showConfirm('删除' + typeName, message, async (confirmed) => {
    if (confirmed) {
      if (data.type === 'folder') {
        await ipcRenderer.invoke('delete-folder', data.path);
      } else {
        await ipcRenderer.invoke('delete-note', data.path);
      }
      if (currentNote && currentNote.path === data.path) {
        currentNote = null;
        noteTitle.value = '';
        editor.value = '';
        leftPanel.classList.remove('ai-layout-optimized');
        updatePreview(true);
      }
      await loadTree();
    }
  });
}

async function changeNotesDir() {
  if (currentNote) await saveCurrentNote();
  if (currentNoteRight) await saveCurrentNoteRight();
  const newDir = await ipcRenderer.invoke('select-notes-dir');
  if (newDir) {
    resetCurrentLibrary();
    await loadTree();
    await renderLocationsManager();
  }
}

function resetCurrentLibrary() {
  if (editorFindState.editor === editorRight) closeEditorFind();
  lastActiveEditor = editor;
  currentNote = null;
  currentNoteRight = null;
  noteTitle.value = '';
  noteTitleRight.value = '';
  editor.value = '';
  editorRight.value = '';
  leftPanel.classList.remove('ai-layout-optimized');
  rightPanel.classList.remove('ai-layout-optimized');
  rightPanel.style.display = 'none';
  updatePreview(true);
  expandedFolders.clear();
  saveWorkspaceSession();
}

async function switchNotesLocation(locationPath) {
  if (currentNote) await saveCurrentNote();
  if (currentNoteRight) await saveCurrentNoteRight();
  const result = await ipcRenderer.invoke('switch-notes-dir', locationPath);
  if (!result.success) {
    showConfirm('切换失败', result.error, () => {});
    return;
  }
  resetCurrentLibrary();
  await loadTree();
  locationsModal.classList.remove('active');
}

async function renderLocationsManager() {
  const data = await ipcRenderer.invoke('get-notes-locations');
  locationsList.innerHTML = '';
  data.locations.forEach(location => {
    const row = document.createElement('div');
    row.className = 'location-row';
    row.classList.toggle('active', location.path === data.activePath);

    const selectButton = document.createElement('button');
    selectButton.className = 'location-select';
    selectButton.innerHTML = `
      <span class="location-status"></span>
      <span class="location-copy">
        <strong>${escapeHtml(location.alias || location.name)}</strong>
        <small>${escapeHtml(location.path)}</small>
      </span>
      ${location.path === data.activePath ? '<span class="location-badge">当前</span>' : ''}
    `;
    selectButton.addEventListener('click', () => switchNotesLocation(location.path));

    const renameButton = document.createElement('button');
    renameButton.className = 'location-action';
    renameButton.textContent = '别名';
    renameButton.addEventListener('click', () => {
      locationsModal.classList.remove('active');
      showModal('设置目录别名', '留空则显示文件夹名称', location.alias, async alias => {
        await ipcRenderer.invoke('set-location-alias', {
          locationPath: location.path,
          alias
        });
        await loadTree();
        await showLocationsManager();
      });
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'location-action danger';
    removeButton.textContent = '移除';
    removeButton.disabled = data.locations.length <= 1;
    removeButton.addEventListener('click', () => {
      showConfirm('移除存储目录', `仅从列表移除“${location.alias || location.name}”，不会删除磁盘文件。`, async () => {
        const result = await ipcRenderer.invoke('remove-notes-dir', location.path);
        if (!result.success) {
          showConfirm('移除失败', result.error, () => {});
          return;
        }
        if (location.path === data.activePath) {
          resetCurrentLibrary();
          await loadTree();
        }
        await renderLocationsManager();
      });
    });

    row.append(selectButton, renameButton, removeButton);
    locationsList.appendChild(row);
  });
}

async function showLocationsManager() {
  await renderLocationsManager();
  locationsModal.classList.add('active');
}

async function moveItem(item, targetFolderPath) {
  const result = await ipcRenderer.invoke('move-item', {
    sourcePath: item.path,
    targetPath: targetFolderPath,
    type: item.type
  });
  
  if (result.success) {
    if (currentNote && currentNote.path === item.path) {
      currentNote = { ...currentNote, path: result.newPath };
    }
    if (targetFolderPath) {
      expandedFolders.add(targetFolderPath);
    }
    await loadTree();
    saveWorkspaceSession();
  } else {
    showConfirm('移动失败', result.error, () => {});
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let saveTimeout = null;

editor.addEventListener('input', () => {
  updatePreview();
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (currentNote) {
      saveCurrentNote();
    }
  }, 1000);
});


settingsBtn.addEventListener('click', showLocationsManager);
notesDirInfo.addEventListener('click', showLocationsManager);
locationsAdd.addEventListener('click', changeNotesDir);
locationsModal.addEventListener('click', event => {
  if (event.target === locationsModal) locationsModal.classList.remove('active');
});

ipcRenderer.on('open-settings', showSettingsDialog);
ipcRenderer.on('open-release-notes', showReleaseNotes);
settingsModal.addEventListener('click', event => {
  if (event.target === settingsModal) hideSettingsDialog();
});
imageDirectoryChoose.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  const requestId = ++settingsRequestId;
  setSettingsBusy(true);
  try {
    const result = await ipcRenderer.invoke('select-image-directory');
    if (requestId !== settingsRequestId) return;
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage('选择图片目录失败', result.error);
      return;
    }
    renderImageDirectorySettings(result);
    if (result.canceled && result.error) {
      settingsError.textContent = getSettingsErrorMessage('当前目录不可用', result.error);
    }
  } catch (error) {
    if (requestId !== settingsRequestId) return;
    settingsError.textContent = getSettingsErrorMessage('选择图片目录失败', error);
  } finally {
    if (requestId === settingsRequestId) setSettingsBusy(false);
  }
});
imageDirectoryReset.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  const requestId = ++settingsRequestId;
  setSettingsBusy(true);
  try {
    const result = await ipcRenderer.invoke('reset-image-directory');
    if (requestId !== settingsRequestId) return;
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage('恢复默认目录失败', result.error);
      return;
    }
    renderImageDirectorySettings(result);
  } catch (error) {
    if (requestId !== settingsRequestId) return;
    settingsError.textContent = getSettingsErrorMessage('恢复默认目录失败', error);
  } finally {
    if (requestId === settingsRequestId) setSettingsBusy(false);
  }
});
templateDirectoryChoose.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  setSettingsBusy(true);
  try {
    const result = await ipcRenderer.invoke('select-template-directory');
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage('选择模板目录失败', result.error);
    } else if (!result.canceled) {
      renderTemplateDirectorySettings(result);
    }
  } catch (error) {
    settingsError.textContent = getSettingsErrorMessage('选择模板目录失败', error);
  } finally {
    setSettingsBusy(false);
  }
});
templateDirectoryClear.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  setSettingsBusy(true);
  try {
    const result = await ipcRenderer.invoke('clear-template-directory');
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage('清除模板目录失败', result.error);
    } else {
      renderTemplateDirectorySettings(result);
    }
  } catch (error) {
    settingsError.textContent = getSettingsErrorMessage('清除模板目录失败', error);
  } finally {
    setSettingsBusy(false);
  }
});
hiddenDirectoryAdd.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  setSettingsBusy(true);
  try {
    const result = await ipcRenderer.invoke('select-hidden-directory');
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage(
        '新增隐藏目录失败',
        result.error
      );
      return;
    }
    if (result.canceled) return;
    renderHiddenDirectorySettings(result.directories);
    await loadTree();
  } catch (error) {
    settingsError.textContent = getSettingsErrorMessage('新增隐藏目录失败', error);
  } finally {
    setSettingsBusy(false);
  }
});
deepseekApiKeySave.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  setSettingsBusy(true);
  try {
    const result = await ipcRenderer.invoke('set-ai-settings', {
      apiKey: deepseekApiKey.value,
      layoutPrompt: deepseekLayoutPrompt.value
    });
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage('保存 API Key 失败', result.error);
      return;
    }
    deepseekApiKey.value = deepseekApiKey.value.trim();
    deepseekLayoutPrompt.value = result.layoutPrompt;
    aiSettingsStatus.textContent = result.configured ? '已配置' : '未配置';
  } catch (error) {
    settingsError.textContent = getSettingsErrorMessage('保存 API Key 失败', error);
  } finally {
    setSettingsBusy(false);
  }
});
deepseekApiKey.addEventListener('keydown', event => {
  if (event.key === 'Enter') deepseekApiKeySave.click();
});
aiStampPositionInputs.forEach(input => {
  input.addEventListener('change', async () => {
    if (!input.checked) return;
    const previousPosition = app.dataset.aiStampPosition;
    const requestId = ++aiStampRequestId;
    settingsError.textContent = '';
    applyAiStampPosition(input.value);
    try {
      const result = await ipcRenderer.invoke('set-ai-stamp-position', input.value);
      if (requestId !== aiStampRequestId) return;
      if (!result.success) {
        applyAiStampPosition(previousPosition);
        settingsError.textContent = getSettingsErrorMessage(
          '保存印章位置失败',
          result.error
        );
      }
    } catch (error) {
      if (requestId !== aiStampRequestId) return;
      applyAiStampPosition(previousPosition);
      settingsError.textContent = getSettingsErrorMessage('保存印章位置失败', error);
    }
  });
});
settingsTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateSettingsTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + settingsTabs.length)
      % settingsTabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % settingsTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = settingsTabs.length - 1;
    activateSettingsTab(settingsTabs[nextIndex], true);
  });
});
outlineToggle.addEventListener('click', () => {
  outlineEnabled = !outlineEnabled;
  localStorage.setItem('outline-enabled', String(outlineEnabled));
  applyOutlineSetting();
});
templateCancel.addEventListener('click', hideTemplateDialog);
templateModal.addEventListener('click', event => {
  if (event.target === templateModal) hideTemplateDialog();
});

function closeTopmostModal() {
  if (confirmModal.classList.contains('active')) {
    hideConfirm();
  } else if (modal.classList.contains('active')) {
    hideModal();
  } else if (templateModal.classList.contains('active')) {
    hideTemplateDialog();
  } else if (settingsModal.classList.contains('active')) {
    hideSettingsDialog();
  } else if (locationsModal.classList.contains('active')) {
    locationsModal.classList.remove('active');
  } else {
    return false;
  }
  return true;
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !closeTopmostModal()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

document.addEventListener('keydown', event => {
  if (!settingsModal.classList.contains('active')) return;

  if (event.key !== 'Tab') return;
  const focusable = Array.from(settingsModal.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), '
      + '[href], [tabindex]:not([tabindex="-1"])'
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!settingsModal.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}, true);

noteTitle.addEventListener('change', async () => {
  if (currentNote) {
    await saveCurrentNote();
  }
});
noteTitle.addEventListener('keydown', event => {
  if (event.key === 'Enter') noteTitle.blur();
});

notesList.addEventListener('contextmenu', (e) => {
  if (e.target === notesList) {
    e.preventDefault();
    contextMenuData = { type: 'root', path: null };
    ipcRenderer.send('show-context-menu', contextMenuData);
  }
});

notesList.addEventListener('dragover', (e) => {
  if (e.target === notesList && draggedItem) {
    e.preventDefault();
    notesList.classList.add('drag-over-root');
    e.dataTransfer.dropEffect = 'move';
  }
});

notesList.addEventListener('dragleave', (e) => {
  if (e.target === notesList) {
    notesList.classList.remove('drag-over-root');
  }
});

notesList.addEventListener('drop', (e) => {
  if (e.target === notesList && draggedItem) {
    e.preventDefault();
    notesList.classList.remove('drag-over-root');
    moveItem(draggedItem, null);
  }
});

ipcRenderer.on('new-note', () => createNewNote(null));
ipcRenderer.on('new-folder', () => createNewFolder(null));
ipcRenderer.on('save-note', saveCurrentNote);
ipcRenderer.on('export-pdf', exportCurrentNoteToPdf);
ipcRenderer.on('insert-table', insertMarkdownTable);
ipcRenderer.on('insert-code-block', insertMarkdownCodeFence);
ipcRenderer.on('insert-template', showTemplateDialog);
ipcRenderer.on('ai-optimize-layout', () => optimizeActiveNoteLayout());
ipcRenderer.on('ai-optimize-layout-selection', () => {
  optimizeActiveNoteLayout({ selectionOnly: true });
});
ipcRenderer.on('ai-translate', (event, targetLanguage) => {
  translateActiveNote(targetLanguage);
});
ipcRenderer.on('notes-tree-changed', scheduleTreeRefresh);
window.addEventListener('focus', scheduleTreeRefresh);
ipcRenderer.on('format-markdown', (event, format) => formatActiveMarkdown(format));
ipcRenderer.on('code-language-selected', (event, language) => {
  const pending = pendingCodeFenceCompletion;
  pendingCodeFenceCompletion = null;
  applySelectedCodeLanguage(pending, language);
});
ipcRenderer.on('table-context-action', (event, action) => {
  if (!tableContextActionHandler) return;
  const handler = tableContextActionHandler;
  tableContextActionHandler = null;
  handler(action);
});
ipcRenderer.on('change-dir', changeNotesDir);
ipcRenderer.on('set-sidebar-visibility', (event, visible) => setSidebarVisibility(visible));
ipcRenderer.on('set-preview-visibility', (event, visible) => setPreviewVisibility(visible));
ipcRenderer.on('set-color-theme', (event, theme) => setColorTheme(theme));

ipcRenderer.on('context-menu-rename', (event, data) => {
  renameItem(data || contextMenuData);
});

ipcRenderer.on('context-menu-delete', (event, data) => {
  deleteItem(data || contextMenuData);
});

ipcRenderer.on('context-menu-new-note', (event, data) => {
  createNewNote(data.path);
});

ipcRenderer.on('context-menu-new-folder', (event, data) => {
  createNewFolder(data.path);
});

async function openInRightPanel(note) {
  if (currentNote && currentNote.path === note.path) return;
  closeSlashCommandMenu();
  currentNoteRight = note;
  noteTitleRight.value = note.name;
  editorRight.value = '';
  const [content, optimizedState] = await Promise.all([
    ipcRenderer.invoke('read-note', note.path),
    ipcRenderer.invoke('get-ai-optimized-state', note.path)
  ]);
  if (!currentNoteRight || currentNoteRight.path !== note.path) return;
  editorRight.value = content;
  rightPanel.classList.toggle(
    'ai-layout-optimized',
    optimizedState.success && optimizedState.optimized
  );
  updatePreviewRight(true);
  rightPanel.style.display = 'flex';
  panelDivider.classList.remove('hidden');
  renderTree();
  saveWorkspaceSession();
}

function closeRightPanel() {
  closeSlashCommandMenu();
  if (editorFindState.editor === editorRight) closeEditorFind();
  lastActiveEditor = editor;
  if (currentNoteRight) {
    saveCurrentNoteRight();
  }
  currentNoteRight = null;
  noteTitleRight.value = '';
  editorRight.value = '';
  rightPanel.classList.remove('ai-layout-optimized');
  updatePreviewRight();
  rightPanel.style.display = 'none';
  panelDivider.classList.add('hidden');
  renderTree();
  saveWorkspaceSession();
}

let previewTimeoutRight = null;

function updatePreviewRight(immediate = false) {
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
  renderDocumentOutline(editorRight, documentOutlineRight);
  if (previewHiddenRight || rightPanel.style.display === 'none') return;
  if (previewTimeoutRight) clearTimeout(previewTimeoutRight);
  if (!immediate) {
    previewTimeoutRight = setTimeout(() => updatePreviewRight(true), 150);
    return;
  }
  previewTimeoutRight = null;
  const content = editorRight.value;
  previewRight.innerHTML = marked.parse(normalizePreviewMarkdown(content));
  bindPreviewTaskCheckboxes(previewRight, editorRight);
  resolvePreviewImages(previewRight, currentNoteRight);
}

async function saveCurrentNoteRight() {
  if (!currentNoteRight) return;

  const newName = noteTitleRight.value.trim() || 'untitled';
  const content = editorRight.value;
  
  const renamed = newName !== currentNoteRight.name;
  if (renamed) {
    const result = await ipcRenderer.invoke('rename-note', {
      oldPath: currentNoteRight.path,
      newName: newName
    });
    currentNoteRight = result;
  }

  await ipcRenderer.invoke('save-note', {
    notePath: currentNoteRight.path,
    content: content
  });

  if (renamed) await loadTree();
}

let saveTimeoutRight = null;

editorRight.addEventListener('input', () => {
  updatePreviewRight();
  if (saveTimeoutRight) clearTimeout(saveTimeoutRight);
  saveTimeoutRight = setTimeout(() => {
    if (currentNoteRight) {
      saveCurrentNoteRight();
    }
  }, 1000);
});

function handleImagePaste(event, editorElement, getCurrentNote) {
  pasteImages(event, editorElement, getCurrentNote).catch(err => {
    showConfirm('图片粘贴失败', err.message, () => {});
  });
}

editor.addEventListener('paste', event => {
  handleImagePaste(event, editor, () => currentNote);
});
editorRight.addEventListener('paste', event => {
  handleImagePaste(event, editorRight, () => currentNoteRight);
});

noteTitleRight.addEventListener('change', async () => {
  if (currentNoteRight) {
    await saveCurrentNoteRight();
  }
});
noteTitleRight.addEventListener('keydown', event => {
  if (event.key === 'Enter') noteTitleRight.blur();
});

closeRightBtn.addEventListener('click', closeRightPanel);

let isDraggingPanel = false;
let panelWidthRatio = 0.5;

panelDivider.addEventListener('mousedown', (e) => {
  isDraggingPanel = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isDraggingPanel) return;
  
  const wrapperRect = document.querySelector('.editors-wrapper').getBoundingClientRect();
  const newRatio = (e.clientX - wrapperRect.left) / wrapperRect.width;
  
  if (newRatio > 0.2 && newRatio < 0.8) {
    panelWidthRatio = newRatio;
    leftPanel.style.flex = 'none';
    leftPanel.style.width = `${panelWidthRatio * 100}%`;
    rightPanel.style.flex = 1;
  }
});

document.addEventListener('mouseup', () => {
  if (isDraggingPanel) {
    isDraggingPanel = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

window.addEventListener('beforeunload', saveWorkspaceSession);
loadTree().then(restoreWorkspaceSession);
