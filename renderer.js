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

const notesList = document.getElementById('notesList');
const slashCommandMenuElement = document.getElementById('slashCommandMenu');
const slashCommandState = {
  editor: null,
  query: '',
  commands: [],
  selectedIndex: 0,
  composing: false
};
let lastActiveEditor = null;
const editor = createCodeEditor(document.getElementById('editor'));
const preview = document.getElementById('preview');
const noteTitle = document.getElementById('noteTitle');
const settingsBtn = document.getElementById('settingsBtn');
const notesDirInfo = document.getElementById('notesDirInfo');
const notesDirDisplay = document.getElementById('notesDirDisplay');
const editorContainer = document.getElementById('editorContainer');
const documentOutline = document.getElementById('documentOutline');

const editorRight = createCodeEditor(document.getElementById('editorRight'));
lastActiveEditor = editor;
const previewRight = document.getElementById('previewRight');
const noteTitleRight = document.getElementById('noteTitleRight');
const editorContainerRight = document.getElementById('editorContainerRight');
const documentOutlineRight = document.getElementById('documentOutlineRight');
const rightPanel = document.getElementById('rightPanel');
const leftPanel = document.getElementById('leftPanel');
const panelDivider = document.getElementById('panelDivider');
const closeRightBtn = document.getElementById('closeRightBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');

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
    renderEditorDecorations(editorAdapter, getNote());
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
  ipcRenderer.send('show-code-language-menu', {
    x: cursorPosition.left,
    y: cursorPosition.bottom
  });
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
const locationsClose = document.getElementById('locationsClose');
const locationsAdd = document.getElementById('locationsAdd');
const settingsModal = document.getElementById('settingsModal');
const imageDirectoryPath = document.getElementById('imageDirectoryPath');
const imageDirectoryMode = document.getElementById('imageDirectoryMode');
const imageDirectoryChoose = document.getElementById('imageDirectoryChoose');
const imageDirectoryReset = document.getElementById('imageDirectoryReset');
const templateDirectoryPath = document.getElementById('templateDirectoryPath');
const templateDirectoryMode = document.getElementById('templateDirectoryMode');
const templateDirectoryChoose = document.getElementById('templateDirectoryChoose');
const templateDirectoryClear = document.getElementById('templateDirectoryClear');
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
let outlineEnabled = localStorage.getItem('outline-enabled') !== 'false';

function applyOutlineSetting() {
  app.classList.toggle('outline-hidden', !outlineEnabled);
  outlineToggle.setAttribute('aria-checked', String(outlineEnabled));
}

applyOutlineSetting();

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
}

function resetImageDirectorySettings() {
  imageDirectoryPath.textContent = '';
  imageDirectoryMode.textContent = '正在加载…';
  settingsIsCustom = false;
  imageDirectoryReset.disabled = true;
  renderTemplateDirectorySettings({ path: '', exists: false });
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
  settingsModal.classList.add('active');
  imageDirectoryChoose.focus();
  const requestId = ++settingsRequestId;
  setSettingsBusy(true);
  try {
    const [result, templateResult] = await Promise.all([
      ipcRenderer.invoke('get-image-directory'),
      ipcRenderer.invoke('get-template-directory')
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
  } else if (e.key === 'Escape') {
    hideModal();
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
  if (currentNote && currentNote.path === note.path) return;
  
  if (currentNoteRight && currentNoteRight.path === note.path) {
    closeRightPanel();
  }
  
  closeSlashCommandMenu();
  currentNote = note;
  noteTitle.value = note.name;
  const content = await ipcRenderer.invoke('read-note', note.path);
  editor.value = content;
  updatePreview(true);
  renderTree();
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
  title.append(titleLabel, titleCount);
  container.appendChild(title);
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
      });
    });
    container.appendChild(item);
  });
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
  let inCodeFence = codeBlocks.some(block => {
    return block.start < firstLine && block.end >= firstLine;
  });

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

  function createImageWidget(match) {
    const widget = document.createElement('span');
    widget.className = 'cm-image-widget';
    widget.title = '选中图片';
    const image = document.createElement('img');
    image.alt = match[1] || '图片';
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
      if (
        pendingCodeFocusEditor?.editor === editorAdapter
        && pendingCodeFocusEditor.line === block.start
      ) {
        const focusCodeEditor = () => {
          const codeElement = widget.querySelector('code[contenteditable]');
          if (!focusEditableAtStart(codeElement)) return;
          if (
            pendingCodeFocusEditor?.editor === editorAdapter
            && pendingCodeFocusEditor.line === block.start
          ) {
            pendingCodeFocusEditor = null;
          }
        };
        queueMicrotask(focusCodeEditor);
        requestAnimationFrame(focusCodeEditor);
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
    const fenceLine = codeBlocks.some(block => (
      block.start === lineNumber || (block.closed && block.end === lineNumber)
    ));
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
        const widget = createImageWidget(activeImageMatch);
        widget.classList.add('is-source-visible');
        const lineWidget = codeMirror.addLineWidget(lineNumber, widget, {
          above: false,
          coverGutter: false,
          noHScroll: true
        });
        editorAdapter.decorationWidgets.push(lineWidget);
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
      if (fenceLine) inCodeFence = !inCodeFence;
      return;
    }

    if (fenceLine) {
      addMark(
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: lineText.length },
        { collapsed: true }
      );
      inCodeFence = !inCodeFence;
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
      const widget = createImageWidget(match);

      const from = { line: lineNumber, ch: match.index };
      const to = { line: lineNumber, ch: match.index + match[0].length };
      const mark = addMark(from, to, {
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
  currentNote = null;
  currentNoteRight = null;
  noteTitle.value = '';
  noteTitleRight.value = '';
  editor.value = '';
  editorRight.value = '';
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
locationsClose.addEventListener('click', () => locationsModal.classList.remove('active'));
locationsAdd.addEventListener('click', changeNotesDir);
locationsModal.addEventListener('click', event => {
  if (event.target === locationsModal) locationsModal.classList.remove('active');
});

ipcRenderer.on('open-settings', showSettingsDialog);
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
outlineToggle.addEventListener('click', () => {
  outlineEnabled = !outlineEnabled;
  localStorage.setItem('outline-enabled', String(outlineEnabled));
  applyOutlineSetting();
});
templateCancel.addEventListener('click', hideTemplateDialog);
templateModal.addEventListener('click', event => {
  if (event.target === templateModal) hideTemplateDialog();
});
document.addEventListener('keydown', event => {
  if (!settingsModal.classList.contains('active')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    hideSettingsDialog();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = Array.from(settingsModal.querySelectorAll(
    'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
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
ipcRenderer.on('notes-tree-changed', scheduleTreeRefresh);
window.addEventListener('focus', scheduleTreeRefresh);
ipcRenderer.on('format-markdown', (event, format) => formatActiveMarkdown(format));
ipcRenderer.on('code-language-selected', (event, language) => {
  const pending = pendingCodeFenceCompletion;
  pendingCodeFenceCompletion = null;
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

function openInRightPanel(note) {
  if (currentNote && currentNote.path === note.path) return;
  closeSlashCommandMenu();
  currentNoteRight = note;
  noteTitleRight.value = note.name;
  editorRight.value = '';
  ipcRenderer.invoke('read-note', note.path).then(content => {
    editorRight.value = content;
    updatePreviewRight(true);
  });
  rightPanel.style.display = 'flex';
  panelDivider.classList.remove('hidden');
  renderTree();
}

function closeRightPanel() {
  closeSlashCommandMenu();
  if (currentNoteRight) {
    saveCurrentNoteRight();
  }
  currentNoteRight = null;
  noteTitleRight.value = '';
  editorRight.value = '';
  updatePreviewRight();
  rightPanel.style.display = 'none';
  panelDivider.classList.add('hidden');
  renderTree();
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

loadTree();
