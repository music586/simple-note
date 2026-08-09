const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { ipcRenderer, clipboard } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');
const katex = require('katex');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const CodeMirror = require('./codemirror6-adapter');
const { EditorPanePersistence } = require('./editor-pane-persistence');
const { configureMarkdownDialect } = require('./markdown-dialect');
const { createPreviewSanitizer } = require('./preview-security');
const mermaidVersion = require('mermaid/package.json').version;
const sanitizePreviewHtml = createPreviewSanitizer(window);
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
const { createSingleTableCommit, getTableAddControlState } = require('./table-ui');
const { getTaskCheckboxEdit } = require('./preview-task');
const { getMarkdownFormatEdit } = require('./markdown-format');
const { buildQuickOpenItems, filterQuickOpenItems } = require('./quick-open');
const { compareLines, buildDiffSummary } = require('./note-history-diff');
const {
  isMermaidDiagramStart,
  normalizePreviewMarkdown
} = require('./preview-markdown');
const {
  preserveEditorScrollPosition,
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
  normalizeClipboardMarkdown,
  joinClipboardStructuredContent,
  removeGeneratedBoundaryNewlines,
  shouldConvertClipboardHtml,
  isMarkdownDocumentText,
  applyClipboardMarkdownMarks,
  optimizeClipboardPlainText
} = require('./clipboard-format');
const {
  filterStructureCommands,
  analyzeLineContext,
  getRenderedListPrefix,
  shouldRenderActiveListPrefix,
  getActiveBulletSourceCursor,
  getHeadingSectionMap,
  getDocumentOutline,
  getFencedCodeBlocks,
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit,
  getSlashMenuUpdate,
  getSlashCommandEdit
} = require('./markdown-structure');

configureMarkdownDialect({ marked, hljs, katex });

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
let workspaceSessionKey = 'workspace-session:pending';
let currentWorkspaceId = null;
let lineNumbersEnabled = localStorage.getItem('line-numbers-enabled') === 'true';

const notesList = document.getElementById('notesList');
const slashCommandMenuElement = document.getElementById('slashCommandMenu');
const codeLanguagePicker = document.getElementById('codeLanguagePicker');
const codeLanguageSearch = document.getElementById('codeLanguageSearch');
const codeLanguageResults = document.getElementById('codeLanguageResults');
const quickOpenModal = document.getElementById('quickOpenModal');
const quickOpenInput = document.getElementById('quickOpenInput');
const quickOpenResults = document.getElementById('quickOpenResults');
const noteHistoryModal = document.getElementById('noteHistoryModal');
const noteHistoryNoteName = document.getElementById('noteHistoryNoteName');
const noteHistoryVersions = document.getElementById('noteHistoryVersions');
const noteHistoryMeta = document.getElementById('noteHistoryMeta');
const noteHistoryPreview = document.getElementById('noteHistoryPreview');
const noteHistoryCurrent = document.getElementById('noteHistoryCurrent');
const noteHistoryDiffSummary = document.getElementById('noteHistoryDiffSummary');
const noteHistoryPin = document.getElementById('noteHistoryPin');
const noteHistoryLabel = document.getElementById('noteHistoryLabel');
const noteHistoryNote = document.getElementById('noteHistoryNote');
const noteHistoryMetadataSave = document.getElementById('noteHistoryMetadataSave');
const noteHistoryCopySelection = document.getElementById('noteHistoryCopySelection');
const noteHistoryInsertSelection = document.getElementById('noteHistoryInsertSelection');
const noteHistoryReplaceSelection = document.getElementById('noteHistoryReplaceSelection');
const noteHistoryError = document.getElementById('noteHistoryError');
const noteHistoryCancel = document.getElementById('noteHistoryCancel');
const noteHistoryRestore = document.getElementById('noteHistoryRestore');
const noteHistoryState = {
  target: null,
  versions: [],
  selectedIndex: -1,
  currentHash: null,
  historicalContent: '',
  requestId: 0
};
const quickOpenState = {
  items: [],
  results: [],
  selectedIndex: 0
};
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
  {
    label: 'Mermaid',
    language: 'mermaid',
    keywords: ['mermaid', '图表', '流程图']
  },
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
const newWindowWelcome = document.getElementById('newWindowWelcome');
const welcomeChooseDirectory = document.getElementById('welcomeChooseDirectory');
const welcomeUseCurrent = document.getElementById('welcomeUseCurrent');
const welcomeCloseWindow = document.getElementById('welcomeCloseWindow');
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

function createEditorPanePersistence({ getNote, setNote, titleInput, editorAdapter }) {
  return new EditorPanePersistence({
    getNote,
    setNote,
    getName: () => titleInput.value,
    getContent: () => editorAdapter.value,
    renameNote: data => ipcRenderer.invoke('rename-note', data),
    saveNote: data => ipcRenderer.invoke('save-note', data),
    onRenamed: async ({ oldPath, newPath }) => {
      editorAdapter.renameDocument(oldPath, newPath);
      await loadTree();
    },
    onError: error => showConfirm('保存失败', error.message, () => {})
  });
}

const leftPanePersistence = createEditorPanePersistence({
  getNote: () => currentNote,
  setNote: note => { currentNote = note; },
  titleInput: noteTitle,
  editorAdapter: editor
});
const rightPanePersistence = createEditorPanePersistence({
  getNote: () => currentNoteRight,
  setNote: note => { currentNoteRight = note; },
  titleInput: noteTitleRight,
  editorAdapter: editorRight
});

function loadPaneDocument(persistence, editorAdapter, documentPath, content) {
  persistence.activateDocument(documentPath);
  editorAdapter.loadDocument(documentPath, content);
}
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
    version: '1.2.0',
    date: '2026-08-01',
    title: 'macOS 安装包兼容性修复',
    content: '修复分架构 macOS 安装包中的残留签名问题，避免下载后的应用被系统误判为损坏。',
    paragraphs: [
      '修复 Apple Silicon（arm64）和 Intel（x64）安装包中 Electron 可执行文件残留的'
        + '不完整签名，为整个应用生成一致的 ad-hoc 签名，避免 macOS 将签名结构异常误报为'
        + '“应用已损坏”或拒绝执行未签名的 arm64 程序。',
      '打包流程会在生成 DMG 前统一签名应用及其 Electron Helper 和 Framework，确保嵌套代码'
        + '签名完整，同时保留按处理器架构拆分安装包带来的下载体积优势。',
      '发布流程新增最终产物检查：分别挂载 arm64 和 x64 DMG，并验证其中的应用不存在'
        + '残缺签名；检查失败时会停止发布，防止问题安装包上传。'
    ],
    highlights: ['一致的 ad-hoc 签名', '分架构安装兼容性', 'DMG 发布校验']
  },
  {
    version: '1.1.6',
    date: '2026-08-01',
    title: 'Markdown 粘贴与安装包优化',
    content: '优化 Markdown 文档粘贴识别，并将 macOS 安装包按处理器架构拆分发布，'
      + '减少用户单次下载的安装包体积。',
    paragraphs: [
      '从剪贴板粘贴包含标题、围栏代码块或表格分隔行的 Markdown 文档时，现在会直接保留'
        + '原始 Markdown 源码，不再误识别为代码并额外添加围栏。',
      'macOS 安装包由通用架构改为分别提供 Apple Silicon（arm64）和 Intel（x64）版本，'
        + '用户可以根据 Mac 的处理器类型下载更精简的安装包。',
      '发布流程升级至 Node.js 22，并在发布前分别构建和校验两种架构的 DMG 文件，避免上传'
        + '错误架构或残留的通用安装包。'
    ],
    highlights: ['Markdown 源码粘贴', '分架构 macOS 安装包', '发布流程校验']
  },
  {
    version: '1.1.5',
    date: '2026-08-01',
    title: 'Mermaid 图表与编辑稳定性',
    content: '新增 Mermaid 多类型图表预渲染和真实尺寸查看器，并优化源码编辑、'
      + '焦点切换及高度变化时的滚动稳定性。',
    paragraphs: [
      '新增 Mermaid 图表支持，可识别 flowchart、sequenceDiagram、stateDiagram-v2、'
        + 'classDiagram、gantt、pie 和 journey；无语言标记的围栏代码块及直接书写的'
        + '图表声明也可以自动识别。',
      '图表渲染采用安全模式、主题适配、内容哈希缓存和异步版本校验。语法错误会在原位置'
        + '显示中文提示并保留源码，单个图表失败不会影响整篇笔记预览。',
      '单击图表可打开真实尺寸查看器，弹窗宽高以预渲染容器为最小尺寸，并在真实图表超过'
        + '最小尺寸时按内容和合理边距扩展；超出窗口后可在弹窗内部滚动，点击遮罩或按 Esc'
        + '即可关闭。编辑区图表支持双击进入 Mermaid 源码。',
      '完善预渲染高度变化时的视觉锚点，保持变化区域上方内容和滚动位置稳定；普通文本获得'
        + '焦点、同一行移动光标或点击编辑器空白区域时，会跳过无效装饰重建，减少页面闪烁。'
    ],
    highlights: ['多类型 Mermaid', '安全预渲染', '真实尺寸查看器', '滚动与重绘稳定性']
  },
  {
    version: '1.1.4',
    date: '2026-07-30',
    title: '全屏、预览与新建体验',
    content: '新增 macOS 原生全屏入口与 Esc 退出；统一预览、阅读模式的背景和顶部布局，'
      + '并将新建笔记改为直接创建与就地命名。',
    paragraphs: [
      '视图菜单新增“进入全屏幕”，支持 macOS 原生全屏切换，并修复 Esc 无法退出全屏的'
        + '问题。阅读模式进入全屏后会隐藏边栏折叠按钮，退出全屏时自动恢复。',
      '重新整理编辑器、预览器和阅读模式的顶部关系。预览与阅读区域恢复柔和的淡灰背景，'
        + '顶栏与内容区保持一致；双栏分割线延伸到顶部，并在顶部 Hover 底线出现时隐藏'
        + '横线以上的竖向分隔，让窗口顶部保持完整连贯。',
      '预览区顶部不再显示文件名，文件名保留在编辑侧；目录展开时，顶部 Hover 底线不会'
        + '覆盖左侧目录边栏。',
      '新建笔记不再弹出名称对话框。应用会直接创建“未命名”笔记并全选文件名，按一次'
        + 'Delete 或 Backspace 即可清空后输入；遇到同名文件时自动生成安全的递增名称。'
    ],
    highlights: ['原生全屏', '预览与阅读布局', '即时新建笔记']
  },
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
      const mark = codeMirror.addMarkDecoration(
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

async function openRenderedMarkdownLink(href, note) {
  const target = String(href || '').trim();
  if (!target) return;
  if (/^(?:https?:)?\/\//i.test(target)) {
    const externalUrl = target.startsWith('//') ? `https:${target}` : target;
    await ipcRenderer.invoke('open-external-url', externalUrl);
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    await ipcRenderer.invoke('open-application-url', target);
    return;
  }
  if (!note || target.startsWith('#')) return;

  const result = await ipcRenderer.invoke('open-relative-link', {
    sourceNotePath: note.path,
    href: target
  });
  if (!result.success || result.type !== 'note') return;
  const linkedNote = getTreeNoteByPath(tree, result.path) || {
    type: 'file',
    path: result.path,
    name: path.basename(result.path, path.extname(result.path))
  };
  await selectNote(linkedNote);
}

[
  [preview, () => currentNote],
  [previewRight, () => currentNoteRight]
].forEach(([container, getNote]) => {
  container.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || !container.contains(link)) return;
    event.preventDefault();
    openRenderedMarkdownLink(link.getAttribute('href'), getNote());
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
  if (editorAdapter.decorationViewportTimer) {
    clearTimeout(editorAdapter.decorationViewportTimer);
    editorAdapter.decorationViewportTimer = null;
  }
  if (editorAdapter.decorationFrame || editorAdapter.renderingDecorations) return;
  editorAdapter.decorationFrame = requestAnimationFrame(() => {
    editorAdapter.decorationFrame = null;
    if (editorAdapter.renderingDecorations) return;
    const codeMirror = editorAdapter.codeMirror;
    preserveEditorScrollPosition(codeMirror, () => {
      codeMirror.operation(() => {
        renderEditorDecorations(editorAdapter, getNote());
      });
    });
    editorAdapter.decorationCursorState = getEditorDecorationCursorState(editorAdapter);
  });
}

function getEditorDecorationCursorState(editorAdapter) {
  const codeMirror = editorAdapter.codeMirror;
  const cursor = codeMirror.getCursor();
  const lineText = codeMirror.getLine(cursor.line) || '';
  const listPrefix = getRenderedListPrefix(lineText);
  if (listPrefix) {
    const listCursorCh = getActiveBulletSourceCursor(listPrefix, cursor.ch);
    const showsRenderedPrefix = shouldRenderActiveListPrefix(listPrefix, listCursorCh);
    return `line:${cursor.line}:list-prefix:${showsRenderedPrefix}`;
  }

  const structure = editorAdapter.decorationStructure;
  const codeBlock = structure
    ? findContainingCodeBlock(structure.blocks, cursor.line)
    : null;
  const hasSourceVisibilityChange = Boolean(
    codeBlock
    || /^\s*(?:#{1,6}\s+|>\s?)/.test(lineText)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lineText)
    || /!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)/.test(lineText)
    || /\*\*[^*]+\*\*|~~[^~]+~~|==[^=]+==|`[^`]+`/.test(lineText)
    || /(?<!\*)\*[^*]+\*(?!\*)/.test(lineText)
  );
  return hasSourceVisibilityChange ? `line:${cursor.line}` : 'stable';
}

function scheduleCursorEditorDecorations(editorAdapter, getNote) {
  const nextState = getEditorDecorationCursorState(editorAdapter);
  if (
    !editorAdapter.decorationStructureDirty
    && editorAdapter.decorationCursorState === nextState
  ) return;
  scheduleEditorDecorations(editorAdapter, getNote);
}

function scheduleViewportEditorDecorations(editorAdapter, getNote) {
  if (editorAdapter.renderingDecorations) return;
  const viewport = editorAdapter.codeMirror.getViewport();
  const range = editorAdapter.decorationRange;
  const lineCount = editorAdapter.codeMirror.lineCount();
  if (range) {
    const stableFrom = range.from === 0 ? 0 : range.from + 20;
    const stableTo = range.to === lineCount ? lineCount : range.to - 20;
    if (viewport.from >= stableFrom && viewport.to <= stableTo) return;
  }
  if (editorAdapter.decorationViewportTimer) {
    clearTimeout(editorAdapter.decorationViewportTimer);
  }
  editorAdapter.decorationViewportTimer = setTimeout(() => {
    editorAdapter.decorationViewportTimer = null;
    scheduleEditorDecorations(editorAdapter, getNote);
  }, 100);
}

function preserveEditorScrollOnClick(editorAdapter) {
  const codeMirror = editorAdapter.codeMirror;
  const input = codeMirror.getInputField();
  let pointerStart = null;

  input.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      top: codeMirror.getScrollInfo().top
    };
  });

  input.addEventListener('click', event => {
    if (!pointerStart) return;
    const snapshot = pointerStart;
    pointerStart = null;
    if (
      Math.abs(event.clientX - snapshot.x) > 4
      || Math.abs(event.clientY - snapshot.y) > 4
    ) return;

    const restore = () => codeMirror.scrollTo(null, snapshot.top);
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  });
}

preserveEditorScrollOnClick(editor);
preserveEditorScrollOnClick(editorRight);

function syncEditorHistoryState(editorAdapter = lastActiveEditor) {
  if (!editorAdapter || editorAdapter !== lastActiveEditor) return;
  ipcRenderer.send('editor-history-state-changed', editorAdapter.getHistoryState());
}

function runActiveEditorHistory(direction) {
  const activeElement = document.activeElement;
  if (
    activeElement
    && /^(?:INPUT|TEXTAREA)$/.test(activeElement.tagName)
    && activeElement !== editor.codeMirror.textarea
    && activeElement !== editorRight.codeMirror.textarea
  ) {
    document.execCommand(direction);
    return;
  }
  const targetEditor = lastActiveEditor === editorRight && currentNoteRight ? editorRight : editor;
  targetEditor.runHistoryCommand(direction);
  syncEditorHistoryState(targetEditor);
}

editor.codeMirror.on('historyChange', () => syncEditorHistoryState(editor));
editorRight.codeMirror.on('historyChange', () => syncEditorHistoryState(editorRight));

editor.codeMirror.on('cursorActivity', () => {
  lastActiveEditor = editor;
  if (slashCommandState.editor && slashCommandState.editor !== editor) {
    slashCommandMenu.close();
  }
  updateSlashCommandForEditor(editor);
  scheduleCursorEditorDecorations(editor, () => currentNote);
  updateDocumentOutlineSelection(editor, documentOutline);
});
editor.codeMirror.on('focus', () => {
  lastActiveEditor = editor;
  syncEditorHistoryState(editor);
  if (slashCommandState.editor && slashCommandState.editor !== editor) slashCommandMenu.close();
  updateSlashCommandForEditor(editor);
});
editor.codeMirror.on('viewportChange', () => {
  scheduleViewportEditorDecorations(editor, () => currentNote);
});
editorRight.codeMirror.on('cursorActivity', () => {
  lastActiveEditor = editorRight;
  if (slashCommandState.editor && slashCommandState.editor !== editorRight) {
    slashCommandMenu.close();
  }
  updateSlashCommandForEditor(editorRight);
  scheduleCursorEditorDecorations(editorRight, () => currentNoteRight);
  updateDocumentOutlineSelection(editorRight, documentOutlineRight);
});
editorRight.codeMirror.on('focus', () => {
  lastActiveEditor = editorRight;
  syncEditorHistoryState(editorRight);
  if (slashCommandState.editor && slashCommandState.editor !== editorRight) {
    slashCommandMenu.close();
  }
  updateSlashCommandForEditor(editorRight);
});
editorRight.codeMirror.on('viewportChange', () => {
  scheduleViewportEditorDecorations(editorRight, () => currentNoteRight);
});

let pendingAiContextSelection = null;

function bindEditorSelectionContextMenu(editorAdapter) {
  editorAdapter.codeMirror.getWrapperElement().addEventListener('contextmenu', event => {
    if (!editorAdapter.codeMirror.somethingSelected()) return;
    event.preventDefault();
    lastActiveEditor = editorAdapter;
    pendingAiContextSelection = {
      editor: editorAdapter,
      start: editorAdapter.selectionStart,
      end: editorAdapter.selectionEnd,
      content: editorAdapter.value.slice(
        editorAdapter.selectionStart,
        editorAdapter.selectionEnd
      )
    };
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
  const codeMirror = CodeMirror.createEditor(textarea, {
    mode: 'markdown',
    lineWrapping: true,
    // The active source line uses the proportional Chinese reading font, where
    // six half-width spaces are approximately as wide as two Chinese glyphs.
    indentUnit: 6,
    tabSize: 6,
    viewportMargin: 20,
    lineNumbers: lineNumbersEnabled,
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
    editorAdapter.decorationRange = null;
    editorAdapter.decorationCursorState = null;
    if (!suppressChange) inputHandlers.forEach(handler => handler());
  });

  codeMirror.on('inputRead', () => {
    if (!suppressChange) updateSlashCommandForEditor(editorAdapter);
  });

  const inputField = codeMirror.getInputField();
  const codeMirrorWrapper = codeMirror.getWrapperElement();
  codeMirrorWrapper.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    if (event.target.closest('.cm-line')) return;
    if (event.target.closest(
      '.cm-code-widget, .cm-mermaid-widget, .cm-table-widget, .cm-image-widget'
    )) return;
    if (!event.target.closest(
      '.cm-scroller, .cm-content'
    )) return;

    event.preventDefault();
    inputField.focus({ preventScroll: true });
  }, true);
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
    decorationViewportTimer: null,
    decorationRange: null,
    decorationCursorState: null,
    cursorAlignmentFrame: null,
    renderingDecorations: false,
    decorationStructureDirty: true,
    decorationStructure: null,
    codeHighlightCache: new Map(),
    collapsedHeadings: new Set(),
    get value() {
      return codeMirror.getValue();
    },
    set value(content) {
      suppressChange = true;
      codeMirror.setValue(content || '');
      suppressChange = false;
    },
    loadDocument(documentKey, content) {
      suppressChange = true;
      codeMirror.loadDocument(documentKey, content);
      suppressChange = false;
    },
    replaceContent(content, historyLabel) {
      suppressChange = true;
      codeMirror.setValue(content || '', historyLabel);
      suppressChange = false;
    },
    renameDocument(oldPath, newPath) {
      codeMirror.renameDocument(oldPath, newPath);
    },
    getHistoryState() {
      return codeMirror.getHistoryState();
    },
    runHistoryCommand(direction) {
      return codeMirror.runHistoryCommand(direction);
    },
    historyTransaction(label, callback) {
      return codeMirror.withHistoryLabel(label, callback);
    },
    get selectionStart() {
      return codeMirror.indexFromPos(codeMirror.getCursor('from'));
    },
    get selectionEnd() {
      return codeMirror.indexFromPos(codeMirror.getCursor('to'));
    },
    setRangeText(content, start, end, selectionMode, historyLabel = '编辑') {
      const from = codeMirror.posFromIndex(start);
      codeMirror.withHistoryLabel(historyLabel, () => {
        codeMirror.replaceRange(content, from, codeMirror.posFromIndex(end));
      });
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

const systemColorTheme = window.matchMedia('(prefers-color-scheme: light)');
let colorThemeMode = localStorage.getItem('color-theme') || 'dark';
if (!['system', 'light', 'dark'].includes(colorThemeMode)) colorThemeMode = 'dark';
let colorTheme = colorThemeMode === 'system'
  ? (systemColorTheme.matches ? 'light' : 'dark')
  : colorThemeMode;
const accentThemeNames = {
  indigo: '默认蓝紫',
  teal: '青松',
  amber: '琥珀'
};
let accentTheme = localStorage.getItem('accent-theme');
if (!accentThemeNames[accentTheme]) accentTheme = 'indigo';

function resolveColorTheme(theme, systemTheme) {
  if (theme !== 'system') return theme;
  if (systemTheme === 'light' || systemTheme === 'dark') return systemTheme;
  return systemColorTheme.matches ? 'light' : 'dark';
}

function applyColorTheme(theme, systemTheme) {
  colorThemeMode = theme;
  colorTheme = resolveColorTheme(theme, systemTheme);
  document.documentElement.dataset.theme = colorTheme;
  ipcRenderer.send('theme-changed', colorThemeMode);
}

function setColorTheme(theme, systemTheme) {
  if (!['system', 'light', 'dark'].includes(theme)) return;
  applyColorTheme(theme, systemTheme);
  localStorage.setItem('color-theme', theme);
  updatePreview(true);
  updatePreviewRight(true);
}

function applyAccentTheme(theme) {
  accentTheme = accentThemeNames[theme] ? theme : 'indigo';
  document.documentElement.dataset.accent = accentTheme;
}

function setAccentTheme(theme) {
  applyAccentTheme(theme);
  localStorage.setItem('accent-theme', accentTheme);
  syncAccentThemeControls();
  updatePreview(true);
  updatePreviewRight(true);
}

applyColorTheme(colorThemeMode);
applyAccentTheme(accentTheme);

ipcRenderer.on('request-color-theme', () => {
  ipcRenderer.send('theme-changed', colorThemeMode);
});

systemColorTheme.addEventListener('change', () => {
  if (colorThemeMode !== 'system') return;
  applyColorTheme('system');
  updatePreview(true);
  updatePreviewRight(true);
});

ipcRenderer.on('system-color-theme-changed', (event, theme) => {
  if (colorThemeMode !== 'system') return;
  applyColorTheme('system', theme);
  updatePreview(true);
  updatePreviewRight(true);
});

window.addEventListener('storage', event => {
  if (event.key === 'accent-theme') {
    applyAccentTheme(event.newValue);
    syncAccentThemeControls();
    updatePreview(true);
    updatePreviewRight(true);
  } else if (
    event.key === 'color-theme'
    && ['system', 'light', 'dark'].includes(event.newValue)
  ) {
    applyColorTheme(event.newValue);
    updatePreview(true);
    updatePreviewRight(true);
  }
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

ipcRenderer.on('full-screen-changed', (event, enabled) => {
  app.classList.toggle('native-full-screen', enabled);
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

let sidebarTransitionTimer = null;
let sidebarToggleMoveTimer = null;
let sidebarToggleRevealTimer = null;

function beginSidebarTransition() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (sidebarTransitionTimer) clearTimeout(sidebarTransitionTimer);
  app.classList.add('sidebar-transitioning');
  sidebarTransitionTimer = setTimeout(() => {
    app.classList.remove('sidebar-transitioning');
    sidebarTransitionTimer = null;
    editor.codeMirror.refresh();
    editorRight.codeMirror.refresh();
  }, 440);
  return true;
}

function setSidebarVisibility(visible) {
  if (typeof visible !== 'boolean') return;
  if (visible === isSidebarVisible()) return;
  const animate = beginSidebarTransition();
  if (app.classList.contains('reading-mode')) {
    readingSidebarVisible = visible;
    app.classList.toggle('reading-sidebar-visible', readingSidebarVisible);
    toggleSidebarBtn.title = readingSidebarVisible ? '隐藏目录' : '显示目录';
    toggleSidebarBtn.setAttribute('aria-expanded', String(readingSidebarVisible));
    updateSidebarTogglePlacement(readingSidebarVisible, animate);
    reportSidebarVisibility();
    return;
  }
  sidebarHidden = !visible;
  app.classList.toggle('sidebar-hidden', sidebarHidden);
  toggleSidebarBtn.title = sidebarHidden ? '显示目录' : '隐藏目录';
  toggleSidebarBtn.setAttribute('aria-expanded', String(!sidebarHidden));
  updateSidebarTogglePlacement(!sidebarHidden, animate);
  reportSidebarVisibility();
  localStorage.setItem('sidebar-hidden', sidebarHidden);
}

function updateSidebarTogglePlacement(expanded, animate = false) {
  const sidebarHeader = document.querySelector('.sidebar-header');
  const leftToolbar = document.querySelector('#leftPanel > .toolbar');
  const destination = expanded ? sidebarHeader : leftToolbar;
  const moveToggle = () => {
    if (expanded) destination.appendChild(toggleSidebarBtn);
    else destination.prepend(toggleSidebarBtn);
  };
  if (!animate) {
    moveToggle();
    toggleSidebarBtn.classList.remove('sidebar-toggle-relocating');
    return;
  }

  if (sidebarToggleMoveTimer) clearTimeout(sidebarToggleMoveTimer);
  if (sidebarToggleRevealTimer) clearTimeout(sidebarToggleRevealTimer);
  toggleSidebarBtn.classList.add('sidebar-toggle-relocating');
  sidebarToggleMoveTimer = setTimeout(() => {
    moveToggle();
    sidebarToggleMoveTimer = null;
  }, 110);
  sidebarToggleRevealTimer = setTimeout(() => {
    toggleSidebarBtn.classList.remove('sidebar-toggle-relocating');
    sidebarToggleRevealTimer = null;
  }, 190);
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
const aiProviderApiKey = document.getElementById('aiProviderApiKey');
const aiProviderKeyLabel = document.getElementById('aiProviderKeyLabel');
const aiProviderInputs = Array.from(document.querySelectorAll('input[name="aiProvider"]'));
const deepseekLayoutPrompt = document.getElementById('deepseekLayoutPrompt');
const aiSettingsSave = document.getElementById('aiSettingsSave');
const aiSettingsStatus = document.getElementById('aiSettingsStatus');
const aiKeyTestResult = document.getElementById('aiKeyTestResult');
let aiProviderKeys = {};
let selectedAiProvider = 'deepseek';
const aiStampPositionInputs = Array.from(
  document.querySelectorAll('input[name="aiStampPosition"]')
);
const aiStampPositionControl = document.querySelector('.settings-segmented');
const outlineToggle = document.getElementById('outlineToggle');
const lineNumbersToggle = document.getElementById('lineNumbersToggle');
const accentThemeStatus = document.getElementById('accentThemeStatus');
const accentThemeOptions = Array.from(document.querySelectorAll('.accent-theme-option'));
const accentThemeReset = document.getElementById('accentThemeReset');
const historyStorageSummary = document.getElementById('historyStorageSummary');
const historyVersionCount = document.getElementById('historyVersionCount');
const historyPinnedCount = document.getElementById('historyPinnedCount');
const historyStorageSize = document.getElementById('historyStorageSize');
const historyBucketMinutes = document.getElementById('historyBucketMinutes');
const historyMaxVersions = document.getElementById('historyMaxVersions');
const historyMaxAgeDays = document.getElementById('historyMaxAgeDays');
const historyCleanup = document.getElementById('historyCleanup');
const historySettingsSave = document.getElementById('historySettingsSave');
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
const aiProviderNames = { deepseek: 'DeepSeek', mimo: 'MiMo', hunyuan: '腾讯混元' };
let activeAiProviderName = 'DeepSeek';
let aiStampRequestId = 0;
let outlineEnabled = localStorage.getItem('outline-enabled') !== 'false';
let outlineCollapsed = localStorage.getItem('outline-collapsed') === 'true';
const outlineHighlightStates = new WeakMap();

function syncAccentThemeControls() {
  if (!accentThemeStatus) return;
  accentThemeStatus.textContent = accentThemeNames[accentTheme];
  accentThemeOptions.forEach(option => {
    const selected = option.dataset.accent === accentTheme;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  });
  accentThemeReset.disabled = accentTheme === 'indigo';
}

syncAccentThemeControls();

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

function applyLineNumbersSetting() {
  lineNumbersToggle.setAttribute('aria-checked', String(lineNumbersEnabled));
  editor.codeMirror.setLineNumbers(lineNumbersEnabled);
  editorRight.codeMirror.setLineNumbers(lineNumbersEnabled);
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
applyLineNumbersSetting();
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
  if (!result.success) return;
  applyAiStampPosition(result.stampPosition);
  activeAiProviderName = aiProviderNames[result.provider] || 'DeepSeek';
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
  aiProviderKeys = { ...data.apiKeys };
  if (!aiProviderKeys.deepseek && data.apiKey) aiProviderKeys.deepseek = data.apiKey;
  const provider = ['deepseek', 'mimo', 'hunyuan'].includes(data.provider)
    ? data.provider
    : 'deepseek';
  if (data.provider) activeAiProviderName = aiProviderNames[provider];
  aiProviderInputs.forEach(input => { input.checked = input.value === provider; });
  selectedAiProvider = provider;
  renderActiveAiProvider(provider);
  deepseekLayoutPrompt.value = data.layoutPrompt || '';
  updateAiProviderStatuses(provider);
  applyAiStampPosition(data.stampPosition);
}

function renderActiveAiProvider(provider) {
  aiProviderKeyLabel.textContent = `${aiProviderNames[provider]} API Key`;
  aiProviderApiKey.placeholder = `请输入 ${aiProviderNames[provider]} API Key`;
  aiProviderApiKey.value = aiProviderKeys[provider] || '';
  renderAiKeyTestResult('', '');
}

function renderAiKeyTestResult(message, state) {
  aiKeyTestResult.textContent = message;
  aiKeyTestResult.dataset.state = state;
}

function updateAiProviderStatuses(activeProvider) {
  document.querySelectorAll('[data-provider-status]').forEach(status => {
    const configured = Boolean(aiProviderKeys[status.dataset.providerStatus]);
    status.textContent = configured ? '已配置' : '未配置';
  });
  aiSettingsStatus.textContent = aiProviderKeys[activeProvider] ? '已启用' : '待配置';
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
  aiProviderApiKey.disabled = busy;
  aiProviderInputs.forEach(input => { input.disabled = busy; });
  deepseekLayoutPrompt.disabled = busy;
  aiSettingsSave.disabled = busy;
  aiStampPositionInputs.forEach(input => {
    input.disabled = busy;
  });
  accentThemeOptions.forEach(option => { option.disabled = busy; });
  accentThemeReset.disabled = busy || accentTheme === 'indigo';
  [historyBucketMinutes, historyMaxVersions, historyMaxAgeDays,
    historyCleanup, historySettingsSave].forEach(control => {
    control.disabled = busy;
  });
}

function renderHistoryStorage(result) {
  historyVersionCount.textContent = String(result.versions || 0);
  historyPinnedCount.textContent = String(result.pinned || 0);
  historyStorageSize.textContent = formatHistorySize(result.bytes || 0);
  historyStorageSummary.textContent = `${result.notes || 0} 篇笔记`;
  historyBucketMinutes.value = result.settings?.bucketMinutes || 5;
  historyMaxVersions.value = result.settings?.maxVersions || 200;
  historyMaxAgeDays.value = result.settings?.maxAgeDays || 180;
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
    const [result, templateResult, hiddenResult, aiResult, historyResult] = await Promise.all([
      ipcRenderer.invoke('get-image-directory'),
      ipcRenderer.invoke('get-template-directory'),
      ipcRenderer.invoke('get-hidden-directories'),
      ipcRenderer.invoke('get-ai-settings'),
      ipcRenderer.invoke('get-history-storage')
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
    if (historyResult.success) renderHistoryStorage(historyResult);
    else settingsError.textContent = getSettingsErrorMessage(
      '历史存储统计失败', historyResult.error
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
  aiProgressLabel.textContent = `${aiProgressAction} · ${activeAiProviderName}`
    + ` · 预计 ${normalizedValue}%`;
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
      targetEditor.setRangeText(
        optimizedContent,
        selectionStart,
        selectionEnd,
        'end',
        'AI 排版'
      );
    } else {
      targetEditor.replaceContent(optimizedContent, 'AI 排版');
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

async function translateActiveNote(targetLanguage, selectionContext = null) {
  if (aiLayoutBusy) {
    showConfirm('AI 正在处理', '请等待当前 AI 操作完成。', () => {});
    return;
  }
  if (!['zh', 'en'].includes(targetLanguage)) return;
  const targetEditor = selectionContext?.editor
    || (lastActiveEditor === editorRight ? editorRight : editor);
  const targetNote = targetEditor === editorRight ? currentNoteRight : currentNote;
  if (!targetNote) {
    showConfirm('无法翻译', '请先选择一篇笔记。', () => {});
    return;
  }
  const selectionStart = selectionContext?.start ?? targetEditor.selectionStart;
  const selectionEnd = selectionContext?.end ?? targetEditor.selectionEnd;
  const selectionOnly = selectionContext
    ? selectionEnd > selectionStart && selectionContext.content.length > 0
    : selectionEnd > selectionStart;
  const originalContent = selectionOnly
    ? selectionContext?.content
      || targetEditor.value.slice(selectionStart, selectionEnd)
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
      targetEditor.setRangeText(
        translatedContent,
        selectionStart,
        selectionEnd,
        'end',
        'AI 翻译'
      );
    } else {
      targetEditor.replaceContent(translatedContent, 'AI 翻译');
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
  const workspaceIdentity = `${notesInfo.workspaceId}:${notesInfo.path}`;
  if (workspaceIdentity !== currentWorkspaceId) {
    currentWorkspaceId = workspaceIdentity;
    const directoryKey = crypto.createHash('sha256')
      .update(notesInfo.path)
      .digest('hex')
      .slice(0, 16);
    workspaceSessionKey = `workspace-session:${notesInfo.workspaceId}:${directoryKey}`;
    workspaceSessionRestored = false;
  }
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

function renderQuickOpenResults() {
  quickOpenResults.innerHTML = '';
  quickOpenState.results = filterQuickOpenItems(
    quickOpenState.items,
    quickOpenInput.value
  );
  quickOpenState.selectedIndex = Math.min(
    quickOpenState.selectedIndex,
    Math.max(0, quickOpenState.results.length - 1)
  );

  if (!quickOpenState.results.length) {
    const empty = document.createElement('div');
    empty.className = 'quick-open-empty';
    empty.textContent = '没有匹配的文件或文件夹';
    quickOpenResults.appendChild(empty);
    quickOpenInput.removeAttribute('aria-activedescendant');
    return;
  }

  quickOpenState.results.forEach((item, index) => {
    const row = document.createElement('div');
    row.id = `quickOpenResult-${index}`;
    row.className = 'quick-open-result';
    row.dataset.type = item.type;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === quickOpenState.selectedIndex));

    const icon = document.createElement('span');
    icon.className = 'quick-open-result-icon';
    icon.innerHTML = item.type === 'folder'
      ? '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v10H3z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4"/></svg>';
    const copy = document.createElement('span');
    copy.className = 'quick-open-result-copy';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const itemPath = document.createElement('small');
    itemPath.textContent = item.relativePath;
    copy.append(name, itemPath);
    row.append(icon, copy);
    row.addEventListener('mousemove', () => selectQuickOpenResult(index));
    row.addEventListener('click', () => activateQuickOpenResult(index));
    quickOpenResults.appendChild(row);
  });
  syncQuickOpenSelection();
}

function syncQuickOpenSelection(scroll = false) {
  const rows = quickOpenResults.querySelectorAll('.quick-open-result');
  rows.forEach((row, index) => {
    row.setAttribute('aria-selected', String(index === quickOpenState.selectedIndex));
  });
  const selected = rows[quickOpenState.selectedIndex];
  if (!selected) return;
  quickOpenInput.setAttribute('aria-activedescendant', selected.id);
  if (scroll) selected.scrollIntoView({ block: 'nearest' });
}

function selectQuickOpenResult(index, scroll = false) {
  if (index < 0 || index >= quickOpenState.results.length) return;
  quickOpenState.selectedIndex = index;
  syncQuickOpenSelection(scroll);
}

async function activateQuickOpenResult(index = quickOpenState.selectedIndex) {
  const item = quickOpenState.results[index];
  if (!item) return;
  if (item.type === 'folder') {
    quickOpenInput.value = `${item.relativePath}/`;
    quickOpenState.selectedIndex = 0;
    renderQuickOpenResults();
    quickOpenInput.focus();
    return;
  }
  hideQuickOpen();
  await selectNote(item);
  editor.focus();
}

function showQuickOpen() {
  closeSlashCommandMenu();
  quickOpenState.items = buildQuickOpenItems(tree);
  quickOpenState.selectedIndex = 0;
  quickOpenInput.value = '';
  quickOpenModal.classList.add('active');
  renderQuickOpenResults();
  quickOpenInput.focus();
}

function hideQuickOpen() {
  quickOpenModal.classList.remove('active');
  quickOpenInput.removeAttribute('aria-activedescendant');
}

quickOpenInput.addEventListener('input', () => {
  quickOpenState.selectedIndex = 0;
  renderQuickOpenResults();
});

quickOpenInput.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!quickOpenState.results.length) return;
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const next = (
      quickOpenState.selectedIndex + direction + quickOpenState.results.length
    ) % quickOpenState.results.length;
    selectQuickOpenResult(next, true);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    activateQuickOpenResult();
  }
});

quickOpenModal.addEventListener('click', event => {
  if (event.target === quickOpenModal) hideQuickOpen();
});

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

function expandFolderPath(folderPath, items = tree, ancestors = []) {
  if (!folderPath) return false;

  for (const item of items) {
    if (item.type !== 'folder') continue;
    const folderAncestors = [...ancestors, item.path];
    if (item.path === folderPath) {
      folderAncestors.forEach(itemPath => expandedFolders.add(itemPath));
      return true;
    }
    if (expandFolderPath(folderPath, item.children || [], folderAncestors)) return true;
  }

  return false;
}

const animatingTreeFolders = new Set();

function findTreeFolderElement(folderPath) {
  return [...notesList.querySelectorAll('.tree-folder')]
    .find(item => item.dataset.path === folderPath);
}

function playTreeAnimation(element, keyframes, options) {
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return Promise.resolve();
  }
  return element.animate(keyframes, options).finished.catch(() => {});
}

async function toggleTreeFolder(folderPath, folderEl) {
  if (animatingTreeFolders.has(folderPath)) return;
  animatingTreeFolders.add(folderPath);
  const isExpanded = expandedFolders.has(folderPath);
  const expandTiming = { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
  const collapseTiming = { duration: 190, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
  const arrowExpandTiming = { duration: 230, easing: 'cubic-bezier(0.34, 1.36, 0.64, 1)' };
  const arrowCollapseTiming = { duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };

  if (isExpanded) {
    const childrenEl = folderEl.nextElementSibling?.classList.contains('tree-folder-children')
      ? folderEl.nextElementSibling
      : null;
    const childrenHeight = childrenEl?.scrollHeight || 0;
    await Promise.all([
      playTreeAnimation(folderEl.querySelector('.folder-icon'), [
        { transform: 'rotate(90deg)' },
        { transform: 'rotate(0deg)' }
      ], arrowCollapseTiming),
      playTreeAnimation(childrenEl, [
        { height: `${childrenHeight}px`, opacity: 1, transform: 'translateY(0)' },
        { height: `${childrenHeight * 0.58}px`, opacity: 0.68, transform: 'translateY(-1px)' },
        { height: '0', opacity: 0, transform: 'translateY(-5px)' }
      ], collapseTiming)
    ]);
    expandedFolders.delete(folderPath);
    renderTree();
  } else {
    expandedFolders.add(folderPath);
    renderTree();
    const expandedFolderEl = findTreeFolderElement(folderPath);
    const childrenEl = expandedFolderEl?.nextElementSibling;
    const childrenHeight = childrenEl?.scrollHeight || 0;
    await Promise.all([
      playTreeAnimation(expandedFolderEl?.querySelector('.folder-icon'), [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(90deg)' }
      ], arrowExpandTiming),
      playTreeAnimation(childrenEl, [
        { height: '0', opacity: 0, transform: 'translateY(-5px)' },
        { height: `${childrenHeight * 0.72}px`, opacity: 0.76, transform: 'translateY(-1px)' },
        { height: `${childrenHeight}px`, opacity: 1, transform: 'translateY(0)' }
      ], expandTiming)
    ]);
  }

  animatingTreeFolders.delete(folderPath);
  saveWorkspaceSession();
}

function createFolderElement(folder, level) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-folder-wrapper';
  
  const folderEl = document.createElement('div');
  folderEl.className = 'tree-folder';
  folderEl.style.paddingLeft = `calc(8px + ${level}em)`;
  folderEl.dataset.path = folder.path;
  folderEl.dataset.type = 'folder';
  folderEl.draggable = true;
  
  const isExpanded = expandedFolders.has(folder.path);
  
  folderEl.innerHTML = `
    <span class="folder-icon"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span>
    <span class="folder-name">${escapeHtml(folder.name)}</span>
  `;
  
  folderEl.addEventListener('click', () => toggleTreeFolder(folder.path, folderEl));
  
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
  fileEl.style.paddingLeft = `calc(32px + ${level}em)`;
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
  loadPaneDocument(leftPanePersistence, editor, note.path, content);
  leftPanel.classList.toggle(
    'ai-layout-optimized',
    optimizedState.success && optimizedState.optimized
  );
  updatePreview(true);
  renderTree();
  saveWorkspaceSession();
}

let previewTimeout = null;
let mermaidModulePromise = null;
let mermaidRenderQueue = Promise.resolve();
let mermaidRenderId = 0;
const maxMermaidCacheEntries = 100;
const mermaidSvgCache = new Map();
const previewRenderVersions = new WeakMap();
const mermaidViewer = document.createElement('div');
mermaidViewer.className = 'modal mermaid-viewer';
mermaidViewer.setAttribute('role', 'dialog');
mermaidViewer.setAttribute('aria-modal', 'true');
mermaidViewer.setAttribute('aria-labelledby', 'mermaidViewerTitle');
mermaidViewer.tabIndex = -1;
mermaidViewer.innerHTML = `
  <div class="mermaid-viewer-shell">
    <div class="mermaid-viewer-toolbar">
      <div>
        <strong id="mermaidViewerTitle">图表查看器</strong>
        <span>原始尺寸 · 可滚动查看</span>
      </div>
    </div>
    <div class="mermaid-viewer-canvas"></div>
  </div>
`;
document.body.appendChild(mermaidViewer);
const mermaidViewerShell = mermaidViewer.querySelector('.mermaid-viewer-shell');
const mermaidViewerCanvas = mermaidViewer.querySelector('.mermaid-viewer-canvas');

function getMermaidDiagramLabel(source) {
  const declaration = String(source || '').trimStart();
  if (/^gantt\b/i.test(declaration)) return '甘特图';
  if (/^sequenceDiagram\b/i.test(declaration)) return '时序图';
  if (/^stateDiagram-v2\b/i.test(declaration)) return '状态图';
  if (/^classDiagram\b/i.test(declaration)) return '类图';
  if (/^pie\b/i.test(declaration)) return '饼图';
  if (/^journey\b/i.test(declaration)) return '用户旅程';
  return '流程图';
}

function closeMermaidViewer() {
  if (!mermaidViewer.classList.contains('active')) return;
  mermaidViewer.classList.remove('active');
  mermaidViewerCanvas.replaceChildren();
}

function openMermaidViewer(svg, source) {
  if (!svg) return;
  const previewContainer = svg.closest('.cm-mermaid-widget, .mermaid-diagram') || svg;
  const previewBounds = previewContainer.getBoundingClientRect();
  const clonedSvg = svg.cloneNode(true);
  const viewBox = clonedSvg.viewBox.baseVal;
  if (viewBox?.width) {
    const diagramWidth = Math.ceil(viewBox.width);
    const diagramHeight = Math.ceil(viewBox.height);
    const viewerOuterGap = 48;
    const viewerContentPadding = 64;
    const viewerToolbarHeight = 59;
    const availableWidth = Math.max(0, window.innerWidth - viewerOuterGap);
    const availableHeight = Math.max(0, window.innerHeight - viewerOuterGap);
    const minimumWidth = Math.ceil(previewBounds.width);
    const minimumHeight = Math.ceil(previewBounds.height);
    const trueSizeWidth = diagramWidth + viewerContentPadding;
    const trueSizeHeight = diagramHeight + viewerContentPadding + viewerToolbarHeight;
    const shellWidth = Math.min(
      availableWidth,
      Math.max(minimumWidth, trueSizeWidth)
    );
    const shellHeight = Math.min(
      availableHeight,
      Math.max(minimumHeight, trueSizeHeight)
    );

    clonedSvg.style.width = `${diagramWidth}px`;
    clonedSvg.style.height = `${diagramHeight}px`;
    mermaidViewerShell.style.width = `${shellWidth}px`;
    mermaidViewerShell.style.height = `${shellHeight}px`;
  }
  mermaidViewer.querySelector('#mermaidViewerTitle').textContent = getMermaidDiagramLabel(source);
  mermaidViewerCanvas.replaceChildren(clonedSvg);
  mermaidViewer.classList.add('active');
}

function bindMermaidViewer(wrapper, source, onEdit = null) {
  wrapper.tabIndex = 0;
  wrapper.setAttribute(
    'aria-label',
    `${getMermaidDiagramLabel(source)}，单击查看原始大小${onEdit ? '，双击编辑源码' : ''}`
  );
  wrapper.addEventListener('mousedown', event => {
    if (event.button === 0) event.preventDefault();
  });
  let clickTimer = null;
  wrapper.addEventListener('click', () => {
    if (!onEdit) {
      openMermaidViewer(wrapper.querySelector('svg'), source);
      return;
    }
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      openMermaidViewer(wrapper.querySelector('svg'), source);
    }, 220);
  });
  wrapper.addEventListener('dblclick', event => {
    if (!onEdit) return;
    event.preventDefault();
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = null;
    onEdit();
  });
  wrapper.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openMermaidViewer(wrapper.querySelector('svg'), source);
  });
}

mermaidViewer.addEventListener('click', event => {
  if (event.target === mermaidViewer) closeMermaidViewer();
});

function getMermaidModule() {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
  if (mermaidModulePromise) return mermaidModulePromise;

  mermaidModulePromise = new Promise((resolve, reject) => {
    const mermaidModulePath = require.resolve('mermaid');
    const mermaidBundlePath = path.join(
      path.dirname(mermaidModulePath),
      'mermaid.min.js'
    );
    const script = document.createElement('script');
    script.src = pathToFileURL(mermaidBundlePath).href;
    script.addEventListener('load', () => {
      if (globalThis.mermaid) resolve(globalThis.mermaid);
      else reject(new Error('Mermaid 浏览器模块加载失败'));
    }, { once: true });
    script.addEventListener('error', () => {
      reject(new Error('无法加载 Mermaid 浏览器模块'));
    }, { once: true });
    document.head.appendChild(script);
  }).catch(error => {
    mermaidModulePromise = null;
    throw error;
  });
  return mermaidModulePromise;
}

function getMermaidCacheKey(source, theme) {
  return crypto.createHash('sha256')
    .update(`${mermaidVersion}\0${theme}\0strict\0${source}`)
    .digest('hex');
}

function renderMermaidSvg(source, theme) {
  const cacheKey = getMermaidCacheKey(source, theme);
  const cachedRender = mermaidSvgCache.get(cacheKey);
  if (cachedRender) return cachedRender;

  const renderTask = mermaidRenderQueue.then(async () => {
    const mermaid = await getMermaidModule();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme
    });
    mermaidRenderId += 1;
    const result = await mermaid.render(`mermaid-preview-${mermaidRenderId}`, source);
    return result.svg;
  });
  mermaidSvgCache.set(cacheKey, renderTask);
  if (mermaidSvgCache.size > maxMermaidCacheEntries) {
    const oldestCacheKey = mermaidSvgCache.keys().next().value;
    mermaidSvgCache.delete(oldestCacheKey);
  }
  renderTask.catch(() => mermaidSvgCache.delete(cacheKey));
  mermaidRenderQueue = renderTask.catch(() => {});
  return renderTask;
}

function createMermaidError(source, error) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mermaid-error';
  const title = document.createElement('strong');
  title.textContent = 'Mermaid 图表语法错误';
  const message = document.createElement('p');
  message.textContent = error?.message || '无法渲染此图表';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '查看原始代码';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.appendChild(code);
  details.append(summary, pre);
  wrapper.append(title, message, details);
  return wrapper;
}

function isGanttDiagram(source) {
  return /^\s*gantt\b/i.test(source);
}

async function renderMermaidBlocks(container, theme) {
  const blocks = Array.from(container.querySelectorAll('pre > code.language-mermaid'));
  await Promise.all(blocks.map(async code => {
    const source = code.textContent;
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-diagram';
    wrapper.classList.toggle('is-gantt', isGanttDiagram(source));
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute('aria-label', 'Mermaid 图表');
    try {
      wrapper.innerHTML = await renderMermaidSvg(source, theme);
    } catch (error) {
      code.parentElement.replaceWith(createMermaidError(source, error));
      return;
    }
    bindMermaidViewer(wrapper, source);
    code.parentElement.replaceWith(wrapper);
  }));
}

async function renderMarkdownPreview(container, content, editorAdapter, note) {
  const renderVersion = (previewRenderVersions.get(container) || 0) + 1;
  previewRenderVersions.set(container, renderVersion);
  const staging = document.createElement('div');
  const previewHtml = marked.parse(normalizePreviewMarkdown(content));
  staging.innerHTML = sanitizePreviewHtml(previewHtml);
  await renderMermaidBlocks(staging, colorTheme);
  if (previewRenderVersions.get(container) !== renderVersion) return;

  container.replaceChildren(...staging.childNodes);
  bindPreviewTaskCheckboxes(container, editorAdapter);
  resolvePreviewImages(container, note);
}

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
    codeMirror.removeLineDecoration(previous.line, 'wrap', 'document-outline-target');
  }
  codeMirror.addLineDecoration(lineNumber, 'wrap', 'document-outline-target');
  const timer = setTimeout(() => {
    codeMirror.removeLineDecoration(lineNumber, 'wrap', 'document-outline-target');
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
  renderMarkdownPreview(preview, content, editor, currentNote);
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
  const escapeCell = cell => String(cell)
    .replace(/\r\n?/g, '\n')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
  const formatRow = row => `| ${row.map(escapeCell).join(' | ')} |`;
  const separator = alignments.map(alignment => {
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
  });
  return [formatRow(rows[0]), formatRow(separator), ...rows.slice(1).map(formatRow)].join('\n');
}

function getTableCellDisplayText(content) {
  return String(content || '').replace(/<br\s*\/?>/gi, '\n');
}

function insertTableCellLineBreak(cell) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!cell.contains(range.commonAncestorContainer)) return false;

  range.deleteContents();
  const lineBreak = document.createTextNode('\n');
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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
      cell.textContent = getTableCellDisplayText(content);
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
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) {
          cell.blur();
          return;
        }
        insertTableCellLineBreak(cell);
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
  addColumnButton.title = '在右侧添加一列';
  addColumnButton.setAttribute('aria-label', '在表格右侧添加一列');
  const addColumnIcon = document.createElement('span');
  addColumnIcon.className = 'cm-table-add-icon';
  addColumnIcon.textContent = '+';
  const addColumnLabel = document.createElement('span');
  addColumnLabel.className = 'cm-table-add-label';
  addColumnLabel.textContent = '列';
  addColumnButton.append(addColumnIcon, addColumnLabel);
  addColumnButton.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onAddColumn();
  });
  addColumnButton.addEventListener('click', event => {
    if (event.detail !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onAddColumn();
  });

  const addRowButton = document.createElement('button');
  addRowButton.className = 'cm-table-add cm-table-add-row';
  addRowButton.type = 'button';
  addRowButton.title = '在底部添加一行';
  addRowButton.setAttribute('aria-label', '在表格底部添加一行');
  const addRowIcon = document.createElement('span');
  addRowIcon.className = 'cm-table-add-icon';
  addRowIcon.textContent = '+';
  const addRowLabel = document.createElement('span');
  addRowLabel.className = 'cm-table-add-label';
  addRowLabel.textContent = '行';
  const addRowContent = document.createElement('span');
  addRowContent.className = 'cm-table-add-row-content';
  addRowContent.append(addRowIcon, addRowLabel);
  addRowButton.appendChild(addRowContent);
  addRowButton.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onAddRow();
  });
  addRowButton.addEventListener('click', event => {
    if (event.detail !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onAddRow();
  });

  viewport.appendChild(table);
  widget.append(viewport, addColumnButton, addRowButton);
  widget.addEventListener('mousemove', event => {
    if (addColumnButton.contains(event.target)) {
      widget.classList.add('show-add-column');
      widget.classList.remove('show-add-row');
      return;
    }
    if (addRowButton.contains(event.target)) {
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
      if (!widget.isConnected || widget.contains(document.activeElement)) return;
      const nextRows = Array.from(table.rows).map(tableRow => {
        return Array.from(tableRow.cells).map(cell => {
          return (cell.innerText || cell.textContent || '')
            .replace(/\r\n?/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
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

function getCachedCodeHighlight(code, requestedLanguage, cache) {
  const normalizedLanguage = String(requestedLanguage || '').trim().toLowerCase();
  const language = highlightLanguageAliases[normalizedLanguage] || normalizedLanguage;
  const cacheKey = `${language}\u0000${code}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language })
    : hljs.highlightAuto(
      code,
      commonHighlightLanguages.filter(item => hljs.getLanguage(item))
    );
  const result = {
    html: highlighted.value,
    languageLabel: language && hljs.getLanguage(language)
      ? normalizedLanguage || language
      : highlighted.language
  };
  if (code.length <= 100000) {
    cache.set(cacheKey, result);
    while (cache.size > 80) cache.delete(cache.keys().next().value);
  }
  return result;
}

function focusCodeWidgetWithoutScroll(widget, target, focus) {
  const scroller = widget.closest('.cm-scroller');
  const scrollTop = scroller?.scrollTop || 0;
  const scrollLeft = scroller?.scrollLeft || 0;
  const restoreScroll = () => {
    if (!scroller?.isConnected) return;
    scroller.scrollTop = scrollTop;
    scroller.scrollLeft = scrollLeft;
  };
  target.focus({ preventScroll: true });
  focus();
  restoreScroll();
  requestAnimationFrame(restoreScroll);
}

function createEditorCodeWidget(code, requestedLanguage, onCommit, highlightCache) {
  const widget = document.createElement('span');
  widget.className = 'cm-code-widget';
  widget.title = '代码块预览';
  widget.tabIndex = 0;
  const pre = document.createElement('pre');
  const codeElement = document.createElement('code');
  const highlighted = getCachedCodeHighlight(code, requestedLanguage, highlightCache);

  codeElement.className = 'hljs';
  codeElement.innerHTML = highlighted.html;
  codeElement.contentEditable = 'plaintext-only';
  codeElement.spellcheck = false;
  codeElement.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    focusCodeWidgetWithoutScroll(widget, codeElement, () => {
      placeCaretInTableCell(codeElement, event.clientX, event.clientY);
    });
  });
  codeElement.addEventListener('click', event => event.stopPropagation());
  pre.appendChild(codeElement);
  widget.appendChild(pre);

  const { languageLabel } = highlighted;
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

function createEditorMermaidWidget(source, theme, onEdit, onHeightChange) {
  const widget = document.createElement('span');
  widget.className = 'cm-mermaid-widget';
  widget.classList.toggle('is-gantt', isGanttDiagram(source));
  widget.title = 'Mermaid 图表，单击放大，双击编辑源码';
  const status = document.createElement('span');
  status.className = 'cm-mermaid-status';
  status.textContent = '正在渲染图表…';
  widget.appendChild(status);

  renderMermaidSvg(source, theme).then(svg => {
    widget.innerHTML = svg;
    bindMermaidViewer(widget, source, onEdit);
    onHeightChange();
  }).catch(error => {
    widget.classList.add('is-error');
    status.textContent = `Mermaid 图表语法错误：${error?.message || '无法渲染'}`;
    onHeightChange();
  });
  return widget;
}

function getFrontMatterBlock(lines) {
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.slice(1, 202).findIndex(line => line.trim() === '---');
  if (end < 0) return null;
  return { start: 0, end: end + 1, lines: lines.slice(1, end + 1) };
}

function getMathBlocks(lines, codeBlocks) {
  const blocks = [];
  let start = null;
  for (let line = 0; line < lines.length; line += 1) {
    if (findContainingCodeBlock(codeBlocks, line)) continue;
    const value = lines[line].trim();
    if (start === null && /^\$\$(?!\$)/.test(value)) {
      if (/^\$\$(?!\$).*\$\$$/.test(value) && value.length > 4) {
        blocks.push({ start: line, end: line, source: value.slice(2, -2).trim() });
      } else {
        start = line;
      }
    } else if (start !== null && /\$\$$/.test(value)) {
      const source = lines.slice(start, line + 1).join('\n')
        .replace(/^\s*\$\$/, '')
        .replace(/\$\$\s*$/, '')
        .replace(/\\\n/g, '\n')
        .trim();
      blocks.push({ start, end: line, source });
      start = null;
    }
  }
  return blocks;
}

function getCalloutBlocks(lines, codeBlocks) {
  const blocks = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (findContainingCodeBlock(codeBlocks, line)) continue;
    const header = lines[line].match(/^\s*>\s*\[!([A-Za-z]+)\]([+-])?\s*(.*?)(?:\\)?$/);
    if (!header) continue;
    let end = line;
    while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1])) end += 1;
    const body = lines.slice(line + 1, end + 1).map(value => {
      return value.replace(/^\s*>\s?/, '').replace(/\\$/, '');
    }).join('\n').trim();
    blocks.push({
      start: line,
      end,
      type: header[1].toLowerCase(),
      folded: header[2] === '-',
      title: header[3].replace(/\\$/, '').trim(),
      body
    });
    line = end;
  }
  return blocks;
}

function createFrontMatterWidget(block) {
  const widget = document.createElement('span');
  widget.className = 'cm-frontmatter-widget';
  widget.title = '文档属性，双击编辑源码';
  const label = document.createElement('span');
  label.className = 'cm-frontmatter-label';
  label.textContent = '文档属性';
  const summary = document.createElement('span');
  summary.className = 'cm-frontmatter-summary';
  const fields = block.lines.filter(line => /^[-\w]+\s*:/.test(line.trim())).slice(0, 4);
  summary.textContent = fields.length ? fields.join(' · ') : `${block.lines.length} 行 YAML`;
  widget.append(label, summary);
  return widget;
}

function createMathWidget(source, displayMode) {
  const widget = document.createElement(displayMode ? 'span' : 'span');
  widget.className = displayMode ? 'cm-math-widget cm-math-block' : 'cm-math-widget cm-math-inline';
  widget.title = displayMode ? '数学公式，双击编辑源码' : '数学公式';
  try {
    katex.render(source, widget, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false
    });
  } catch (error) {
    widget.classList.add('is-error');
    widget.textContent = `公式错误：${error?.message || '无法渲染'}`;
  }
  return widget;
}

function createCalloutWidget(block) {
  const widget = document.createElement('span');
  widget.className = `cm-callout-widget is-${block.type}`;
  widget.title = '提示块，双击编辑源码';
  const header = document.createElement('span');
  header.className = 'cm-callout-header';
  const names = {
    note: '备注', info: '信息', tip: '提示', success: '成功',
    warning: '警告', caution: '注意', faq: '问题'
  };
  header.textContent = block.title || names[block.type] || block.type.toUpperCase();
  widget.appendChild(header);
  if (block.body) {
    const body = document.createElement('span');
    body.className = 'cm-callout-body';
    body.textContent = block.body;
    body.hidden = block.folded;
    widget.appendChild(body);
  }
  return widget;
}

function createRichInlineWidget(source) {
  const widget = document.createElement('span');
  widget.className = 'cm-rich-inline-widget';
  const template = document.createElement('template');
  template.innerHTML = marked.parseInline(source);
  const allowed = new Set(['STRONG', 'EM', 'DEL', 'CODE', 'MARK']);
  Array.from(template.content.querySelectorAll('*')).forEach(element => {
    if (allowed.has(element.tagName)) {
      Array.from(element.attributes).forEach(attribute => element.removeAttribute(attribute.name));
      return;
    }
    element.replaceWith(document.createTextNode(element.textContent || ''));
  });
  widget.appendChild(template.content);
  return widget;
}

function getCachedDecorationStructure(editorAdapter) {
  if (!editorAdapter.decorationStructureDirty) return editorAdapter.decorationStructure;
  const codeMirror = editorAdapter.codeMirror;
  const lines = Array.from(
    { length: codeMirror.lineCount() },
    (_, line) => codeMirror.getLine(line)
  );
  const blocks = getFencedCodeBlocks(lines);
  const headingSections = getHeadingSectionMap(lines, blocks);

  const frontMatter = getFrontMatterBlock(lines);
  const mathBlocks = getMathBlocks(lines, blocks);
  const calloutBlocks = getCalloutBlocks(lines, blocks);

  editorAdapter.decorationStructure = {
    lines,
    blocks,
    headingSections,
    frontMatter,
    mathBlocks,
    calloutBlocks
  };
  editorAdapter.decorationStructureDirty = false;
  return editorAdapter.decorationStructure;
}

function findContainingCodeBlock(codeBlocks, lineNumber) {
  let low = 0;
  let high = codeBlocks.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const block = codeBlocks[middle];
    if (lineNumber < block.start) high = middle - 1;
    else if (lineNumber > block.end) low = middle + 1;
    else return block;
  }
  return null;
}

function isMermaidCodeBlock(block, documentLines) {
  const language = String(block?.language || '').trim().toLowerCase();
  if (language === 'mermaid') return true;
  if (language || !block) return false;
  return isMermaidDiagramStart(documentLines[block.start + 1] || '');
}

function getRenderedQuotePrefix(lineText) {
  const match = String(lineText || '').match(/^\s*(?:>\s*)+/);
  if (!match) return null;
  return {
    source: match[0],
    depth: (match[0].match(/>/g) || []).length
  };
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
      codeMirror.removeLineDecoration(item.line, 'wrap', item.className);
    });
    editorAdapter.decorationLines = [];
    editorAdapter.decorationWidgets.forEach(widget => widget.clear());
    editorAdapter.decorationWidgets = [];
  });
  if (!note) {
    editorAdapter.decorationRange = null;
    wrapper.style.removeProperty('--editor-cursor-height');
    wrapper.style.removeProperty('--editor-cursor-offset');
    return;
  }

  const activeLine = codeMirror.getCursor().line;
  const viewport = codeMirror.getViewport();
  const firstLine = Math.max(0, viewport.from - 80);
  const lastLine = Math.min(codeMirror.lineCount(), viewport.to + 80);
  editorAdapter.decorationRange = { from: firstLine, to: lastLine };
  const structure = getCachedDecorationStructure(editorAdapter);
  const documentLines = structure.lines;
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const codeBlocks = structure.blocks;
  const headingSections = structure.headingSections;

  function replaceBlockWithWidget(block, widget, renderedLines) {
    if (!block || block.end < firstLine || block.start >= lastLine) return;
    if (activeLine >= block.start && activeLine <= block.end) return;
    const from = { line: block.start, ch: 0 };
    const to = { line: block.end, ch: codeMirror.getLine(block.end).length };
    let mark;
    const editSource = event => {
      event.preventDefault();
      if (mark) mark.clear();
      codeMirror.setCursor({ line: block.start, ch: 0 });
      codeMirror.focus();
    };
    widget.addEventListener('dblclick', editSource);
    mark = addMark(from, to, {
      replacedWith: widget,
      atomic: true,
      handleMouseEvents: true
    });
    for (let line = block.start; line <= block.end; line += 1) renderedLines.add(line);
  }

  function addMark(from, to, options) {
    const mark = codeMirror.addMarkDecoration(from, to, options);
    editorAdapter.decorationMarks.push(mark);
    return mark;
  }

  function addBookmark(position, options) {
    const mark = codeMirror.addWidgetDecoration(position, options);
    editorAdapter.decorationMarks.push(mark);
    return mark;
  }

  function addLineStyle(lineNumber, className) {
    const line = codeMirror.addLineDecoration(lineNumber, 'wrap', className);
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

  function markCompletedTaskText(lineNumber, lineText, listPrefix) {
    if (!listPrefix?.checked || listPrefix.toCh >= lineText.length) return;
    addMark(
      { line: lineNumber, ch: listPrefix.toCh },
      { line: lineNumber, ch: lineText.length },
      { className: 'cm-task-completed-text' }
    );
  }

  function createEditorLinkWidget(label, href) {
    const link = document.createElement('span');
    const external = /^(?:https?:)?\/\//i.test(href);
    const application = !external && /^[a-z][a-z0-9+.-]*:/i.test(href);
    const linkType = external ? 'is-external' : application ? 'is-application' : 'is-relative';
    link.className = `cm-rendered-link ${linkType}`;
    link.textContent = label;
    link.title = href;
    link.tabIndex = 0;
    link.setAttribute('role', 'link');
    const openLink = event => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      openRenderedMarkdownLink(href, note);
    };
    link.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    link.addEventListener('click', openLink);
    link.addEventListener('keydown', openLink);
    return link;
  }

  Array.from(editorAdapter.collapsedHeadings).forEach(headingLine => {
    const section = headingSections.get(headingLine);
    if (!section || section.startLine > section.endLine) {
      editorAdapter.collapsedHeadings.delete(headingLine);
      return;
    }
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
    const renderedSpecialLines = new Set();
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
      if (isMermaidCodeBlock(block, documentLines)) {
        if (activeLine >= block.start && activeLine <= block.end) return;
        const widget = createEditorMermaidWidget(
          code,
          colorTheme,
          () => {
            const pageScrollX = window.scrollX;
            const pageScrollY = window.scrollY;
            const restorePageScroll = () => {
              window.scrollTo(pageScrollX, pageScrollY);
            };
            preserveEditorScrollPosition(codeMirror, () => {
              if (codeMark) codeMark.clear();
              codeMirror.setCursor({ line: block.start + 1, ch: 0 });
              codeMirror.getInputField().focus({ preventScroll: true });
            });
            restorePageScroll();
            requestAnimationFrame(restorePageScroll);
          },
          () => scheduleDecorationHeightChange(() => {
            return editorAdapter.decorationMarks.includes(codeMark) ? codeMark : null;
          }, codeMirror)
        );
        codeMark = addMark(from, to, {
          replacedWith: widget,
          atomic: true,
          handleMouseEvents: true
        });
        renderedCodeLines.add(block.start);
        return;
      }
      const widget = createEditorCodeWidget(code, block.language, nextCode => {
        if (codeMark) codeMark.clear();
        const safeLanguage = String(block.language || '').replace(/[^\w+-]/g, '');
        const fence = `\`\`\`${safeLanguage}\n${nextCode}\n\`\`\``;
        codeMirror.replaceRange(fence, from, to);
        scheduleEditorDecorations(editorAdapter, () => note);
      }, editorAdapter.codeHighlightCache);
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
        focusCodeWidgetWithoutScroll(widget, widget, () => {});
      });
      const visibleStart = Math.max(block.start, firstLine);
      const visibleEnd = Math.min(block.end, lastLine - 1);
      for (let codeLine = visibleStart; codeLine <= visibleEnd; codeLine += 1) {
        renderedCodeLines.add(codeLine);
      }
    });

    replaceBlockWithWidget(
      structure.frontMatter,
      structure.frontMatter ? createFrontMatterWidget(structure.frontMatter) : null,
      renderedSpecialLines
    );
    structure.mathBlocks.forEach(block => {
      replaceBlockWithWidget(block, createMathWidget(block.source, true), renderedSpecialLines);
    });
    structure.calloutBlocks.forEach(block => {
      replaceBlockWithWidget(block, createCalloutWidget(block), renderedSpecialLines);
    });

    for (let lineNumber = firstLine; lineNumber < lastLine - 1; lineNumber += 1) {
      if (
        fencedLines.has(lineNumber)
        || renderedTableLines.has(lineNumber)
        || renderedCodeLines.has(lineNumber)
        || renderedSpecialLines.has(lineNumber)
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
      const replaceTable = createSingleTableCommit((nextRows, nextAlignments) => {
        if (tableMark) tableMark.clear();
        codeMirror.replaceRange(
          serializeMarkdownTable(nextRows, nextAlignments),
          from,
          to
        );
        scheduleEditorDecorations(editorAdapter, () => note);
      });
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
    if (renderedSpecialLines.has(lineNumber)) return;
    const containingCodeBlock = findContainingCodeBlock(codeBlocks, lineNumber);
    const fenceLine = Boolean(containingCodeBlock && (
      containingCodeBlock.start === lineNumber
      || (containingCodeBlock.closed && containingCodeBlock.end === lineNumber)
    ));
    const inCodeFence = Boolean(containingCodeBlock && !fenceLine);
    const headingPrefix = !inCodeFence && lineText.match(/^(#{1,6})\s+/);
    if (headingPrefix) {
      const section = headingSections.get(lineNumber);
      if (section && section.startLine <= section.endLine) {
        const collapsed = editorAdapter.collapsedHeadings.has(lineNumber);
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
          if (collapsed) editorAdapter.collapsedHeadings.delete(lineNumber);
          else editorAdapter.collapsedHeadings.add(lineNumber);
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
      const activeCursor = codeMirror.getCursor();
      const activeHeading = lineText.match(/^(#{1,6})\s+/);
      const activeQuote = getRenderedQuotePrefix(lineText);
      let editingClassName = 'cm-editing-source-line';
      if (activeHeading) {
        addLineStyle(lineNumber, 'cm-rendered-heading-line');
        addLineStyle(lineNumber, `cm-rendered-heading-line-${activeHeading[1].length}`);
        editingClassName += ` cm-editing-heading cm-rendered-h${activeHeading[1].length}`;
      }
      if (activeQuote) {
        addLineStyle(lineNumber, 'cm-rendered-quote-line');
        addLineStyle(
          lineNumber,
          `cm-rendered-quote-depth-${Math.min(activeQuote.depth, 6)}`
        );
        editingClassName += ' cm-editing-quote';
        if (activeCursor.ch > activeQuote.source.length) {
          addMark(
            { line: lineNumber, ch: 0 },
            { line: lineNumber, ch: activeQuote.source.length },
            { collapsed: true }
          );
        }
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
        imageDecoration = codeMirror.addBlockWidget(lineNumber, widget, {
          above: false,
          coverGutter: false,
          noHScroll: true
        });
        editorAdapter.decorationWidgets.push(imageDecoration);
      }
      imagePattern.lastIndex = 0;
      const activeListPrefix = getRenderedListPrefix(lineText);
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
      markCompletedTaskText(lineNumber, lineText, activeListPrefix);
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

    const quote = getRenderedQuotePrefix(lineText);
    if (quote) {
      addLineStyle(lineNumber, 'cm-rendered-quote-line');
      addLineStyle(lineNumber, `cm-rendered-quote-depth-${Math.min(quote.depth, 6)}`);
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: quote.source.length },
        { collapsed: true }
      );
      addMark(
        { line: lineNumber, ch: quote.source.length },
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
    markCompletedTaskText(lineNumber, lineText, listPrefix);

    const occupiedRanges = [];
    const isOccupied = (from, to) => occupiedRanges.some(range => {
      return from < range.to && to > range.from;
    });
    const replaceInlineRange = (from, to, widget) => {
      if (isOccupied(from, to)) return false;
      addMark(
        { line: lineNumber, ch: from },
        { line: lineNumber, ch: to },
        { replacedWith: widget, atomic: true, handleMouseEvents: true }
      );
      occupiedRanges.push({ from, to });
      return true;
    };

    const richInlinePattern = /\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g;
    while ((match = richInlinePattern.exec(lineText)) !== null) {
      replaceInlineRange(
        match.index,
        match.index + match[0].length,
        createRichInlineWidget(match[0])
      );
    }

    const inlineMathPattern = /(?<!\\)\$(?!\s|\$)([^$\n]+?)(?<!\s)\$/g;
    while ((match = inlineMathPattern.exec(lineText)) !== null) {
      replaceInlineRange(
        match.index,
        match.index + match[0].length,
        createMathWidget(match[1], false)
      );
    }

    const wikiLinkPattern = /(!)?\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
    while ((match = wikiLinkPattern.exec(lineText)) !== null) {
      const embedded = Boolean(match[1]);
      const target = match[2].trim();
      const anchor = match[3] || '';
      const label = (match[4] || target).trim();
      const href = `${target.endsWith('.md') ? target : `${target}.md`}${anchor}`;
      const widget = createEditorLinkWidget(label, href);
      widget.classList.add('is-wiki-link');
      if (embedded) {
        widget.classList.add('is-wiki-embed');
        widget.textContent = `嵌入 · ${label}`;
      }
      replaceInlineRange(match.index, match.index + match[0].length, widget);
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
        if (isOccupied(match.index, match.index + match[0].length)) continue;
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
      if (isOccupied(match.index, match.index + match[0].length)) continue;
      const formattedLabel = /(?:\*\*|\*|~~|`)/.test(match[1]);
      const link = createEditorLinkWidget('', match[2]);
      if (formattedLabel) link.appendChild(createRichInlineWidget(match[1]));
      else link.textContent = match[1];
      replaceInlineRange(match.index, match.index + match[0].length, link);
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
      const cursor = wrapper.querySelector('.cm-cursor');
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

function promoteClipboardInlineStyles(documentNode) {
  documentNode.querySelectorAll('[style]').forEach(node => {
    const style = node.getAttribute('style') || '';
    const wrappers = [];
    if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)) wrappers.push('strong');
    if (/font-style\s*:\s*italic/i.test(style)) wrappers.push('em');
    if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)) wrappers.push('del');
    if (/background(?:-color)?\s*:\s*(?!transparent|none)[^;]+/i.test(style)) {
      wrappers.push('mark');
    }
    wrappers.forEach(tag => {
      const wrapper = documentNode.createElement(tag);
      while (node.firstChild) wrapper.appendChild(node.firstChild);
      node.appendChild(wrapper);
    });
  });
}

function createClipboardTurndown(relativePaths) {
  let imageIndex = 0;
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  });
  service.use(gfm);
  service.addRule('local-images', {
    filter: 'img',
    replacement(content, node) {
      const relativePath = relativePaths[imageIndex++];
      if (!relativePath) return '';
      const alt = String(node.getAttribute('alt') || '图片')
        .replace(/[\[\]]/g, '\\$&');
      return `\n\n![${alt}](${relativePath})\n\n`;
    }
  });
  service.addRule('highlight', {
    filter: 'mark',
    replacement(content) {
      return content.trim() ? `==${content}==` : content;
    }
  });
  service.remove(['script', 'style', 'meta', 'link', 'noscript', 'template']);
  return service;
}

function clipboardHtmlToMarkdown(html, relativePaths) {
  if (!html) return '';
  try {
    const documentNode = new DOMParser().parseFromString(html, 'text/html');
    promoteClipboardInlineStyles(documentNode);
    const service = createClipboardTurndown(relativePaths);
    return normalizeClipboardMarkdown(service.turndown(documentNode.body));
  } catch (error) {
    return clipboardHtmlToMarkdownLegacy(html, relativePaths);
  }
}

function clipboardHtmlToMarkdownLegacy(html, relativePaths) {
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

  return normalizeClipboardMarkdown(convert(documentNode.body));
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
    if (isMarkdownDocumentText(text)) {
      pastedContent = text;
      editorElement.setRangeText(pastedContent, start, end, 'end', '粘贴');
      editorElement.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const editorCode = getClipboardEditorCode(event, htmlSource, text);
    const htmlMarkdown = shouldConvertClipboardHtml(htmlSource)
      ? clipboardHtmlToMarkdown(htmlSource, [])
      : '';
    const optimizedText = optimizeClipboardPlainText(text);
    const textTable = clipboardTextTableToMarkdown(text);
    const structuredContent = editorCode || htmlMarkdown || textTable;
    if (structuredContent) {
      pastedContent = joinClipboardStructuredContent(
        editorElement.value,
        start,
        end,
        structuredContent
      );
    } else {
      pastedContent = optimizedText;
    }
  }
  editorElement.setRangeText(pastedContent, start, end, 'end', '粘贴');
  editorElement.dispatchEvent(new Event('input', { bubbles: true }));
}

async function saveCurrentNote(options) {
  return leftPanePersistence.save(options);
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

function escapeExportHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getExportImageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  }[extension] || 'application/octet-stream';
}

async function inlineExportImages(container) {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(images.map(async image => {
    const source = image.src;
    if (!source || source.startsWith('data:')) return;
    try {
      if (source.startsWith('file:')) {
        const filePath = fileURLToPath(source);
        const data = fs.readFileSync(filePath).toString('base64');
        image.src = `data:${getExportImageMimeType(filePath)};base64,${data}`;
        return;
      }
      if (/^https?:/i.test(source)) {
        const response = await fetch(source, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`图片请求失败：${response.status}`);
        const blob = await response.blob();
        const buffer = Buffer.from(await blob.arrayBuffer());
        image.src = `data:${blob.type || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
      }
    } catch {
      image.removeAttribute('src');
    }
  }));
}

function buildReadingHtml(title, contentHtml) {
  const theme = colorTheme === 'light' ? 'light' : 'dark';
  const accent = document.documentElement.dataset.accent || 'indigo';
  const readingStyles = fs.readFileSync(path.join(__dirname, 'export-reading.css'), 'utf-8')
    .replace(/<\/style/gi, '<\\/style');

  return '<!doctype html>\n'
    + `<html lang="zh-CN" data-theme="${theme}" data-accent="${escapeExportHtml(accent)}">\n`
    + '<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + `<title>${escapeExportHtml(title)}</title>\n`
    + `<style>${readingStyles}</style>\n</head>\n`
    + `<body><main class="preview-content export-reading-page">${contentHtml}</main></body>\n`
    + '</html>\n';
}

async function exportCurrentNoteToHtml() {
  const useRightEditor = lastActiveEditor === editorRight && currentNoteRight;
  const targetEditor = useRightEditor ? editorRight : editor;
  const targetNote = useRightEditor ? currentNoteRight : currentNote;
  const saveTargetNote = useRightEditor ? saveCurrentNoteRight : saveCurrentNote;
  if (!targetNote) {
    showConfirm('无法导出', '请先选择要导出的笔记', () => {});
    return;
  }

  try {
    await saveTargetNote();
    const exportPreview = document.createElement('div');
    await renderMarkdownPreview(exportPreview, targetEditor.value, targetEditor, targetNote);
    await inlineExportImages(exportPreview);
    const html = buildReadingHtml(targetNote.name, exportPreview.innerHTML);
    const result = await ipcRenderer.invoke('export-current-html', {
      suggestedName: targetNote.name,
      html
    });
    if (!result.success && !result.canceled) {
      showConfirm('导出失败', result.error || '无法生成 HTML 文件', () => {});
    }
  } catch (err) {
    showConfirm('导出失败', err.message || '无法生成 HTML 文件', () => {});
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
  targetEditor.setRangeText(insertion, start, end, 'end', '插入表格');
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
  targetEditor.setRangeText('```', start, end, 'end', '插入代码块');
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
  targetEditor.setRangeText(
    result.content,
    start,
    targetEditor.selectionEnd,
    'end',
    '插入模板'
  );
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
  if (currentNote) await saveCurrentNote();
  closeReleaseNotes(editorPane, editor, false);
  closeSlashCommandMenu();

  const result = await ipcRenderer.invoke('create-note', {
    name: '未命名',
    folderPath
  });
  if (!result.success) {
    showConfirm('新建失败', result.error, () => {});
    return;
  }

  currentNote = result.note;
  noteTitle.value = result.note.name;
  loadPaneDocument(leftPanePersistence, editor, result.note.path, '');
  leftPanel.classList.remove('ai-layout-optimized');
  updatePreview(true);
  expandFolderPath(folderPath);
  await loadTree();
  saveWorkspaceSession();

  requestAnimationFrame(() => {
    noteTitle.focus();
    noteTitle.select();
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

function replaceTreePathPrefix(itemPath, oldPath, newPath) {
  if (itemPath === oldPath) return newPath;
  const prefix = `${oldPath}${path.sep}`;
  if (!itemPath.startsWith(prefix)) return itemPath;
  return path.join(newPath, itemPath.slice(prefix.length));
}

function syncRenamedFolderPaths(oldPath, renamedFolder) {
  const newPath = renamedFolder.path;
  if (currentNote) {
    const previousPath = currentNote.path;
    currentNote.path = replaceTreePathPrefix(previousPath, oldPath, newPath);
    editor.renameDocument(previousPath, currentNote.path);
  }
  if (currentNoteRight) {
    const previousPath = currentNoteRight.path;
    currentNoteRight.path = replaceTreePathPrefix(previousPath, oldPath, newPath);
    editorRight.renameDocument(previousPath, currentNoteRight.path);
  }
  expandedFolders = new Set([...expandedFolders].map(folderPath => {
    return replaceTreePathPrefix(folderPath, oldPath, newPath);
  }));
}

function renameItem(data) {
  const row = [...notesList.querySelectorAll('.tree-folder, .tree-file')]
    .find(item => item.dataset.path === data.path);
  const nameElement = row?.querySelector(
    data.type === 'folder' ? '.folder-name' : '.file-name'
  );
  if (!row || !nameElement || row.querySelector('.tree-rename-input')) return;

  const input = document.createElement('input');
  input.className = 'tree-rename-input';
  input.type = 'text';
  input.value = data.name;
  input.setAttribute('aria-label', data.type === 'folder' ? '重命名文件夹' : '重命名笔记');
  nameElement.replaceWith(input);
  row.draggable = false;

  let finished = false;
  const finish = async save => {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    if (!save || !newName || newName === data.name) {
      renderTree();
      return;
    }

    try {
      if (data.type === 'folder') {
        const result = await ipcRenderer.invoke('rename-folder', {
          oldPath: data.path,
          newName
        });
        syncRenamedFolderPaths(data.path, result);
      } else {
        const result = await ipcRenderer.invoke('rename-note', {
          oldPath: data.path,
          newName
        });
        if (currentNote && currentNote.path === data.path) {
          editor.renameDocument(data.path, result.path);
          currentNote = result;
          noteTitle.value = result.name;
        }
        if (currentNoteRight && currentNoteRight.path === data.path) {
          editorRight.renameDocument(data.path, result.path);
          currentNoteRight = result;
          noteTitleRight.value = result.name;
        }
      }
      await loadTree();
      saveWorkspaceSession();
    } catch (error) {
      renderTree();
      showConfirm('重命名失败', error.message, () => {});
    }
  };

  input.addEventListener('click', event => event.stopPropagation());
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });

  input.focus();
  input.select();
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
        loadPaneDocument(leftPanePersistence, editor, null, '');
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
    await restoreWorkspaceSession();
    await renderLocationsManager();
    return true;
  }
  return false;
}

function hideNewWindowWelcome() {
  newWindowWelcome.hidden = true;
  editor.focus();
}

if (new URLSearchParams(window.location.search).get('welcome') === '1') {
  newWindowWelcome.hidden = false;
  requestAnimationFrame(() => welcomeChooseDirectory.focus());
}

welcomeChooseDirectory.addEventListener('click', async () => {
  if (await changeNotesDir()) hideNewWindowWelcome();
});
welcomeUseCurrent.addEventListener('click', hideNewWindowWelcome);
welcomeCloseWindow.addEventListener('click', () => {
  ipcRenderer.invoke('close-current-window');
});

function resetCurrentLibrary() {
  if (editorFindState.editor === editorRight) closeEditorFind();
  lastActiveEditor = editor;
  currentNote = null;
  currentNoteRight = null;
  noteTitle.value = '';
  noteTitleRight.value = '';
  loadPaneDocument(leftPanePersistence, editor, null, '');
  loadPaneDocument(rightPanePersistence, editorRight, null, '');
  leftPanel.classList.remove('ai-layout-optimized');
  rightPanel.classList.remove('ai-layout-optimized');
  rightPanel.style.display = 'none';
  updatePreview(true);
  expandedFolders.clear();
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
  await restoreWorkspaceSession();
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
          await restoreWorkspaceSession();
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

function getActiveHistoryTarget() {
  const useRight = lastActiveEditor === editorRight && currentNoteRight;
  return {
    side: useRight ? 'right' : 'left',
    note: useRight ? currentNoteRight : currentNote,
    editor: useRight ? editorRight : editor,
    save: useRight ? saveCurrentNoteRight : saveCurrentNote
  };
}

function getHistoryReasonLabel(reason) {
  return {
    baseline: '初始版本',
    'auto-save': '自动保存',
    'manual-save': '手动保存',
    'partial-restore': '局部恢复',
    'before-restore': '恢复前备份',
    restore: '历史恢复'
  }[reason] || '已保存';
}

function formatHistorySize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function hideNoteHistory() {
  noteHistoryState.requestId += 1;
  noteHistoryState.target = null;
  noteHistoryModal.classList.remove('active');
}

function renderNoteHistoryVersions() {
  noteHistoryVersions.innerHTML = '';
  if (!noteHistoryState.versions.length) {
    const empty = document.createElement('div');
    empty.className = 'note-history-empty';
    empty.textContent = '暂无可用的历史版本';
    noteHistoryVersions.appendChild(empty);
    return;
  }
  noteHistoryState.versions.forEach((version, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'note-history-version';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === noteHistoryState.selectedIndex));
    if (index === noteHistoryState.selectedIndex) row.classList.add('selected');
    const heading = document.createElement('span');
    heading.className = 'note-history-version-heading';
    heading.textContent = version.label || formatDate(version.savedAt);
    const details = document.createElement('span');
    details.className = 'note-history-version-details';
    details.textContent = `${getHistoryReasonLabel(version.reason)} · ${formatHistorySize(version.size)}`;
    row.append(heading, details);
    if (version.pinned) {
      const pin = document.createElement('span');
      pin.className = 'note-history-pinned';
      pin.textContent = '固定';
      row.appendChild(pin);
    }
    if (version.isCurrent) {
      const badge = document.createElement('span');
      badge.className = 'note-history-current';
      badge.textContent = '当前';
      row.appendChild(badge);
    }
    row.addEventListener('click', () => selectNoteHistoryVersion(index));
    noteHistoryVersions.appendChild(row);
  });
}

function appendDiffLine(container, text, type, parts = null) {
  const line = document.createElement('span');
  line.className = `note-history-diff-line ${type}`;
  if (parts) {
    parts.forEach(part => {
      const span = document.createElement('span');
      span.className = `note-history-diff-part ${part.type}`;
      span.textContent = part.text;
      line.appendChild(span);
    });
  } else {
    line.textContent = text ?? '';
  }
  container.appendChild(line);
}

function renderNoteHistoryDiff(historicalContent, currentContent) {
  const rows = compareLines(historicalContent, currentContent);
  noteHistoryPreview.replaceChildren();
  noteHistoryCurrent.replaceChildren();
  rows.forEach(row => {
    if (row.type === 'equal') {
      appendDiffLine(noteHistoryPreview, row.before, 'equal');
      appendDiffLine(noteHistoryCurrent, row.after, 'equal');
    } else if (row.type === 'modify') {
      appendDiffLine(noteHistoryPreview, row.before, 'delete', row.beforeParts);
      appendDiffLine(noteHistoryCurrent, row.after, 'insert', row.afterParts);
    } else if (row.type === 'delete') {
      appendDiffLine(noteHistoryPreview, row.before, 'delete');
      appendDiffLine(noteHistoryCurrent, '', 'empty');
    } else {
      appendDiffLine(noteHistoryPreview, '', 'empty');
      appendDiffLine(noteHistoryCurrent, row.after, 'insert');
    }
  });
  const summary = buildDiffSummary(rows);
  noteHistoryDiffSummary.textContent = summary.inserted || summary.deleted || summary.modified
    ? `+${summary.inserted} −${summary.deleted} · ${summary.modified} 行修改`
    : '与当前版本一致';
}

async function selectNoteHistoryVersion(index) {
  const version = noteHistoryState.versions[index];
  const target = noteHistoryState.target;
  if (!version || !target) return;
  noteHistoryState.selectedIndex = index;
  renderNoteHistoryVersions();
  noteHistoryPreview.textContent = '正在读取版本…';
  noteHistoryCurrent.textContent = '';
  noteHistoryMeta.textContent = `${formatDate(version.savedAt)} · ${getHistoryReasonLabel(version.reason)}`;
  noteHistoryPin.classList.toggle('active', Boolean(version.pinned));
  noteHistoryPin.setAttribute('aria-pressed', String(Boolean(version.pinned)));
  noteHistoryPin.textContent = version.pinned ? '已固定' : '固定版本';
  noteHistoryLabel.value = version.label || '';
  noteHistoryNote.value = version.note || '';
  noteHistoryRestore.disabled = true;
  const requestId = ++noteHistoryState.requestId;
  const result = await ipcRenderer.invoke('read-note-history-version', {
    notePath: target.note.path,
    versionId: version.id
  });
  if (requestId !== noteHistoryState.requestId || !noteHistoryState.target) return;
  if (!result.success) {
    noteHistoryPreview.textContent = '';
    noteHistoryError.textContent = result.error || '版本读取失败';
    return;
  }
  noteHistoryError.textContent = '';
  noteHistoryState.historicalContent = result.content;
  renderNoteHistoryDiff(result.content, target.editor.value);
  noteHistoryRestore.disabled = version.isCurrent;
}

async function saveNoteHistoryMetadata() {
  const target = noteHistoryState.target;
  const index = noteHistoryState.selectedIndex;
  const version = noteHistoryState.versions[index];
  if (!target || !version) return;
  const result = await ipcRenderer.invoke('update-note-history-version', {
    notePath: target.note.path,
    versionId: version.id,
    label: noteHistoryLabel.value,
    note: noteHistoryNote.value,
    pinned: noteHistoryPin.classList.contains('active')
  });
  if (!result.success) {
    noteHistoryError.textContent = result.error || '版本标记保存失败';
    return;
  }
  noteHistoryState.versions[index] = { ...version, ...result.version };
  noteHistoryError.textContent = '版本标记已保存';
  renderNoteHistoryVersions();
}

function getSelectedHistoricalText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !noteHistoryPreview.contains(selection.anchorNode)) {
    noteHistoryError.textContent = '请先在左侧历史版本中选择文本';
    return '';
  }
  return selection.toString();
}

async function applyHistoricalSelection(mode) {
  const text = getSelectedHistoricalText();
  const target = noteHistoryState.target;
  if (!text || !target) return;
  const start = mode === 'insert' ? target.editor.selectionEnd : target.editor.selectionStart;
  const end = mode === 'insert' ? target.editor.selectionEnd : target.editor.selectionEnd;
  const result = await ipcRenderer.invoke('apply-note-history-selection', {
    notePath: target.note.path,
    expectedHash: noteHistoryState.currentHash,
    start,
    end,
    text
  });
  if (!result.success) {
    noteHistoryError.textContent = result.error || '局部恢复失败';
    return;
  }
  target.editor.setRangeText(text, start, end, 'end', '应用历史内容');
  if (target.side === 'right') updatePreviewRight(true);
  else updatePreview(true);
  hideNoteHistory();
  target.editor.focus();
}

async function showNoteHistory() {
  let target = getActiveHistoryTarget();
  if (!target.note) {
    showConfirm('无法查看历史', '请先选择一篇笔记', () => {});
    return;
  }
  await target.save();
  target = getActiveHistoryTarget();
  if (!target.note) return;
  const result = await ipcRenderer.invoke('get-note-history', target.note.path);
  const currentTarget = getActiveHistoryTarget();
  if (!result.success) {
    showConfirm('历史版本读取失败', result.error || '无法读取历史版本', () => {});
    return;
  }
  if (!currentTarget.note || currentTarget.note.path !== target.note.path) return;
  noteHistoryState.target = target;
  noteHistoryState.versions = result.versions;
  noteHistoryState.selectedIndex = result.versions.length ? 0 : -1;
  noteHistoryState.currentHash = result.currentHash;
  noteHistoryNoteName.textContent = target.note.name;
  noteHistoryError.textContent = '';
  noteHistoryPreview.textContent = '';
  noteHistoryRestore.disabled = true;
  noteHistoryModal.classList.add('active');
  renderNoteHistoryVersions();
  if (result.versions.length) await selectNoteHistoryVersion(0);
  noteHistoryVersions.querySelector('button')?.focus();
}

async function restoreSelectedHistoryVersion() {
  const target = noteHistoryState.target;
  const version = noteHistoryState.versions[noteHistoryState.selectedIndex];
  if (!target || !version || version.isCurrent) return;
  showConfirm('恢复历史版本', '当前内容会先自动备份，然后恢复所选版本。', async () => {
    const result = await ipcRenderer.invoke('restore-note-history-version', {
      notePath: target.note.path,
      versionId: version.id,
      expectedHash: noteHistoryState.currentHash
    });
    if (!result.success) {
      noteHistoryError.textContent = result.error || '版本恢复失败';
      return;
    }
    const activeNote = target.side === 'right' ? currentNoteRight : currentNote;
    if (!activeNote || activeNote.path !== target.note.path) return;
    target.editor.replaceContent(result.content, '恢复历史版本');
    if (target.side === 'right') updatePreviewRight(true);
    else updatePreview(true);
    hideNoteHistory();
    target.editor.focus();
  });
}

noteHistoryCancel.addEventListener('click', hideNoteHistory);
noteHistoryRestore.addEventListener('click', restoreSelectedHistoryVersion);
noteHistoryPin.addEventListener('click', () => {
  const active = !noteHistoryPin.classList.contains('active');
  noteHistoryPin.classList.toggle('active', active);
  noteHistoryPin.setAttribute('aria-pressed', String(active));
  noteHistoryPin.textContent = active ? '已固定' : '固定版本';
});
noteHistoryMetadataSave.addEventListener('click', saveNoteHistoryMetadata);
noteHistoryCopySelection.addEventListener('click', () => {
  const text = getSelectedHistoricalText();
  if (!text) return;
  clipboard.writeText(text);
  noteHistoryError.textContent = '已复制选中内容';
});
noteHistoryInsertSelection.addEventListener('click', () => applyHistoricalSelection('insert'));
noteHistoryReplaceSelection.addEventListener('click', () => applyHistoricalSelection('replace'));
noteHistoryModal.addEventListener('click', event => {
  if (event.target === noteHistoryModal) hideNoteHistory();
});
noteHistoryVersions.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Enter') {
    restoreSelectedHistoryVersion();
    return;
  }
  const offset = event.key === 'ArrowUp' ? -1 : 1;
  const next = Math.max(0, Math.min(
    noteHistoryState.versions.length - 1,
    noteHistoryState.selectedIndex + offset
  ));
  selectNoteHistoryVersion(next).then(() => {
    noteHistoryVersions.querySelector('.selected')?.focus();
  });
});

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
aiProviderInputs.forEach(input => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    aiProviderKeys[selectedAiProvider] = aiProviderApiKey.value.trim();
    selectedAiProvider = input.value;
    renderActiveAiProvider(input.value);
    updateAiProviderStatuses(input.value);
  });
});
aiSettingsSave.addEventListener('click', async () => {
  if (settingsBusy) return;
  settingsError.textContent = '';
  setSettingsBusy(true);
  try {
    const provider = aiProviderInputs.find(input => input.checked)?.value || 'deepseek';
    const normalizedApiKey = aiProviderApiKey.value.trim();
    if (normalizedApiKey && normalizedApiKey !== (aiProviderKeys[provider] || '')) {
      renderAiKeyTestResult('正在使用 1 个输出 Token 验证密钥…', 'testing');
      const testResult = await ipcRenderer.invoke('test-ai-api-key', {
        provider,
        apiKey: normalizedApiKey
      });
      if (!testResult.success) {
        renderAiKeyTestResult(`验证失败 · ${testResult.error}`, 'error');
        return;
      }
      renderAiKeyTestResult(`${testResult.providerName} · API Key 有效`, 'success');
    }
    const result = await ipcRenderer.invoke('set-ai-settings', {
      provider,
      apiKey: aiProviderApiKey.value,
      layoutPrompt: deepseekLayoutPrompt.value
    });
    if (!result.success) {
      settingsError.textContent = getSettingsErrorMessage('保存 API Key 失败', result.error);
      return;
    }
    aiProviderKeys[provider] = aiProviderApiKey.value.trim();
    activeAiProviderName = aiProviderNames[provider];
    aiProviderApiKey.value = aiProviderKeys[provider];
    deepseekLayoutPrompt.value = result.layoutPrompt;
    updateAiProviderStatuses(provider);
  } catch (error) {
    settingsError.textContent = getSettingsErrorMessage('保存 API Key 失败', error);
  } finally {
    setSettingsBusy(false);
  }
});
aiProviderApiKey.addEventListener('keydown', event => {
  if (event.key === 'Enter') aiSettingsSave.click();
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
lineNumbersToggle.addEventListener('click', () => {
  lineNumbersEnabled = !lineNumbersEnabled;
  localStorage.setItem('line-numbers-enabled', String(lineNumbersEnabled));
  applyLineNumbersSetting();
});
accentThemeOptions.forEach(option => {
  option.addEventListener('click', () => setAccentTheme(option.dataset.accent));
});
accentThemeReset.addEventListener('click', () => setAccentTheme('indigo'));
historySettingsSave.addEventListener('click', async () => {
  if (settingsBusy) return;
  setSettingsBusy(true);
  settingsError.textContent = '';
  try {
    const result = await ipcRenderer.invoke('set-history-settings', {
      bucketMinutes: historyBucketMinutes.value,
      maxVersions: historyMaxVersions.value,
      maxAgeDays: historyMaxAgeDays.value
    });
    if (!result.success) throw new Error(result.error);
    renderHistoryStorage({ ...result.stats, settings: result.settings });
    settingsError.textContent = '历史版本策略已保存';
  } catch (error) {
    settingsError.textContent = getSettingsErrorMessage('历史版本策略保存失败', error);
  } finally {
    setSettingsBusy(false);
  }
});
historyCleanup.addEventListener('click', () => {
  if (settingsBusy) return;
  showConfirm(
    '清理历史版本',
    '将删除未固定的旧版本，每篇笔记保留最新版本。此操作无法撤销。',
    async () => {
      setSettingsBusy(true);
      const result = await ipcRenderer.invoke('cleanup-note-history', {});
      setSettingsBusy(false);
      if (!result.success) {
        settingsError.textContent = result.error || '历史版本清理失败';
        return;
      }
      renderHistoryStorage(result.stats);
      settingsError.textContent = `已清理 ${result.removed} 个历史版本`;
    }
  );
});
templateCancel.addEventListener('click', hideTemplateDialog);
templateModal.addEventListener('click', event => {
  if (event.target === templateModal) hideTemplateDialog();
});

function closeTopmostModal() {
  if (mermaidViewer.classList.contains('active')) {
    closeMermaidViewer();
  } else if (noteHistoryModal.classList.contains('active')) {
    hideNoteHistory();
  } else if (quickOpenModal.classList.contains('active')) {
    hideQuickOpen();
    editor.focus();
  } else if (confirmModal.classList.contains('active')) {
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

let confirmingNoteTitle = false;

noteTitle.addEventListener('change', async () => {
  if (confirmingNoteTitle) return;
  if (currentNote) {
    await saveCurrentNote();
  }
});
noteTitle.addEventListener('keydown', async event => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  confirmingNoteTitle = true;
  try {
    await saveCurrentNote();
    editor.setCursorIndex(0);
    editor.focus();
  } finally {
    confirmingNoteTitle = false;
  }
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
ipcRenderer.on('quick-open', showQuickOpen);
ipcRenderer.on('editor-undo', () => runActiveEditorHistory('undo'));
ipcRenderer.on('editor-redo', () => runActiveEditorHistory('redo'));
ipcRenderer.on('request-editor-history-state', () => syncEditorHistoryState());
ipcRenderer.on('save-note', () => {
  const save = lastActiveEditor === editorRight && currentNoteRight
    ? saveCurrentNoteRight
    : saveCurrentNote;
  save({ historyReason: 'manual-save' });
});
ipcRenderer.on('open-note-history', showNoteHistory);
ipcRenderer.on('export-pdf', exportCurrentNoteToPdf);
ipcRenderer.on('export-html', exportCurrentNoteToHtml);
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
ipcRenderer.on('ai-translate-selection', (event, targetLanguage) => {
  const selection = pendingAiContextSelection;
  pendingAiContextSelection = null;
  if (!selection) return;
  translateActiveNote(targetLanguage, selection);
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
ipcRenderer.on('set-color-theme', (event, theme, systemTheme) => {
  setColorTheme(theme, systemTheme);
});

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
  loadPaneDocument(rightPanePersistence, editorRight, note.path, '');
  const [content, optimizedState] = await Promise.all([
    ipcRenderer.invoke('read-note', note.path),
    ipcRenderer.invoke('get-ai-optimized-state', note.path)
  ]);
  if (!currentNoteRight || currentNoteRight.path !== note.path) return;
  loadPaneDocument(rightPanePersistence, editorRight, note.path, content);
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
  loadPaneDocument(rightPanePersistence, editorRight, null, '');
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
  renderMarkdownPreview(previewRight, content, editorRight, currentNoteRight);
}

async function saveCurrentNoteRight(options) {
  return rightPanePersistence.save(options);
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
