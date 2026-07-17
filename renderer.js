const path = require('path');
const { pathToFileURL } = require('url');
const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');
const CodeMirror = require('codemirror');
require('codemirror/mode/markdown/markdown');
const {
  filterStructureCommands,
  analyzeLineContext,
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit
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
const editor = createCodeEditor(document.getElementById('editor'));
const preview = document.getElementById('preview');
const noteTitle = document.getElementById('noteTitle');
const settingsBtn = document.getElementById('settingsBtn');
const notesDirInfo = document.getElementById('notesDirInfo');
const notesDirDisplay = document.getElementById('notesDirDisplay');
const editorContainer = document.getElementById('editorContainer');

const editorRight = createCodeEditor(document.getElementById('editorRight'));
let lastActiveEditor = editor;
const previewRight = document.getElementById('previewRight');
const noteTitleRight = document.getElementById('noteTitleRight');
const editorContainerRight = document.getElementById('editorContainerRight');
const rightPanel = document.getElementById('rightPanel');
const leftPanel = document.getElementById('leftPanel');
const panelDivider = document.getElementById('panelDivider');
const closeRightBtn = document.getElementById('closeRightBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');

function applyCodeMirrorEdit(cm, edit) {
  cm.replaceRange(edit.text, edit.from, edit.to);
  cm.setCursor(edit.cursor);
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
  if (selected) {
    slashCommandMenuElement.setAttribute(
      'aria-activedescendant',
      `slash-command-${selected.id}`
    );
  } else {
    slashCommandMenuElement.removeAttribute('aria-activedescendant');
  }
}

function positionSlashCommandMenu(cm) {
  const cursor = cm.cursorCoords(cm.getCursor(), 'window');
  const panel = cm.getWrapperElement().closest('.editor-panel').getBoundingClientRect();
  const menu = slashCommandMenuElement.getBoundingClientRect();
  const left = Math.min(Math.max(cursor.left, panel.left + 8), panel.right - menu.width - 8);
  const below = cursor.bottom + menu.height + 8 <= Math.min(panel.bottom, window.innerHeight);
  const top = below ? cursor.bottom + 4 : Math.max(panel.top + 8, cursor.top - menu.height - 4);
  slashCommandMenuElement.style.left = `${left}px`;
  slashCommandMenuElement.style.top = `${top}px`;
}

function closeSlashCommandMenu() {
  slashCommandState.editor = null;
  slashCommandState.query = '';
  slashCommandState.commands = [];
  slashCommandState.selectedIndex = 0;
  slashCommandMenuElement.hidden = true;
  slashCommandMenuElement.replaceChildren();
}

function openSlashCommandMenu(editorAdapter, query) {
  slashCommandState.editor = editorAdapter;
  slashCommandState.query = query;
  slashCommandState.commands = filterStructureCommands(query);
  slashCommandState.selectedIndex = 0;
  renderSlashCommandMenu();
  slashCommandMenuElement.hidden = false;
  positionSlashCommandMenu(editorAdapter.codeMirror);
}

function updateSlashCommandMenu(editorAdapter, query) {
  openSlashCommandMenu(editorAdapter, query);
}

function moveSlashCommandSelection(delta) {
  const count = slashCommandState.commands.length;
  if (!count) return;
  slashCommandState.selectedIndex = (slashCommandState.selectedIndex + delta + count) % count;
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
  cm.operation(() => {
    applyCodeMirrorEdit(cm, {
      from: { line: cursor.line, ch: 0 },
      to: cursor,
      text: command.prefix,
      cursor: { line: cursor.line, ch: command.prefix.length }
    });
  });
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
  const context = analyzeLineContext(cm.getValue().split('\n'), cursor);
  if (
    context.slashQuery !== null
    && editorHasCurrentNote(editorAdapter)
    && !slashCommandState.composing
  ) {
    slashCommandMenu.update(editorAdapter, context.slashQuery);
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
  scheduleEditorDecorations(editor, () => currentNote);
});
editor.codeMirror.on('viewportChange', () => {
  scheduleEditorDecorations(editor, () => currentNote);
});
editorRight.codeMirror.on('cursorActivity', () => {
  lastActiveEditor = editorRight;
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
});
editorRight.codeMirror.on('viewportChange', () => {
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
});

function createCodeEditor(textarea) {
  let suppressChange = false;
  const inputHandlers = [];
  let editorAdapter = null;
  const codeMirror = CodeMirror.fromTextArea(textarea, {
    mode: 'markdown',
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 2,
    viewportMargin: 20,
    extraKeys: {
      'Cmd-A': 'selectAll',
      'Ctrl-A': 'selectAll',
      Up: cm => {
        if (slashCommandState.editor === editorAdapter && !slashCommandState.composing) {
          slashCommandMenu.move(-1);
          return;
        }
        cm.execCommand('goLineUp');
      },
      Down: cm => {
        if (slashCommandState.editor === editorAdapter && !slashCommandState.composing) {
          slashCommandMenu.move(1);
          return;
        }
        cm.execCommand('goLineDown');
      },
      Esc: () => {
        if (slashCommandState.editor === editorAdapter) slashCommandMenu.close();
      },
      Enter: cm => {
        if (slashCommandState.editor === editorAdapter && !slashCommandState.composing) {
          slashCommandMenu.select();
          return;
        }
        const cursor = cm.getCursor();
        const lineText = cm.getLine(cursor.line);
        const beforeCursor = lineText.slice(0, cursor.ch);
        const afterCursor = lineText.slice(cursor.ch);
        const openingFence = beforeCursor.match(/^(\s*)```[\w+-]*\s*$/);
        let insideCodeFence = false;
        for (let line = 0; line < cursor.line; line += 1) {
          if (/^\s*```/.test(cm.getLine(line))) insideCodeFence = !insideCodeFence;
        }

        if (openingFence && !afterCursor.trim() && !insideCodeFence) {
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
          return;
        }
        cm.execCommand('newlineAndIndent');
      }
    }
  });

  codeMirror.on('change', () => {
    editorAdapter.decorationStructureDirty = true;
    if (!suppressChange) inputHandlers.forEach(handler => handler());
  });

  codeMirror.on('inputRead', (cm, change) => {
    if (change.origin === '+input') updateSlashCommandForEditor(editorAdapter);
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
    decorationFrame: null,
    renderingDecorations: false,
    decorationStructureDirty: true,
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

let colorTheme = localStorage.getItem('color-theme') || 'dark';

function applyColorTheme(theme) {
  colorTheme = theme;
  document.documentElement.dataset.theme = theme;
}

function toggleColorTheme() {
  const nextTheme = colorTheme === 'dark' ? 'light' : 'dark';
  applyColorTheme(nextTheme);
  localStorage.setItem('color-theme', nextTheme);
}

applyColorTheme(colorTheme);

panelDivider.classList.add('hidden');

let previewHiddenLeft = localStorage.getItem('preview-hidden-left') === 'true';

function togglePreviewLeft() {
  previewHiddenLeft = !previewHiddenLeft;
  editorContainer.classList.toggle('preview-hidden', previewHiddenLeft);
  localStorage.setItem('preview-hidden-left', previewHiddenLeft);
  if (!previewHiddenLeft) updatePreview(true);
}

if (previewHiddenLeft) {
  editorContainer.classList.add('preview-hidden');
}

let sidebarHidden = localStorage.getItem('sidebar-hidden') === 'true';
let readingSidebarVisible = false;
const app = document.querySelector('.app');

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
    app.classList.remove('sidebar-hidden');
    toggleSidebarBtn.title = '显示目录';
    updatePreview(true);
  } else {
    app.classList.toggle('sidebar-hidden', sidebarHidden);
    toggleSidebarBtn.title = sidebarHidden ? '显示目录' : '隐藏目录';
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
  if (app.classList.contains('reading-mode')) {
    readingSidebarVisible = !readingSidebarVisible;
    app.classList.toggle('reading-sidebar-visible', readingSidebarVisible);
    toggleSidebarBtn.title = readingSidebarVisible ? '隐藏目录' : '显示目录';
    return;
  }
  sidebarHidden = !sidebarHidden;
  app.classList.toggle('sidebar-hidden', sidebarHidden);
  toggleSidebarBtn.title = sidebarHidden ? '显示目录' : '隐藏目录';
  localStorage.setItem('sidebar-hidden', sidebarHidden);
}

toggleSidebarBtn.addEventListener('click', toggleSidebar);

if (sidebarHidden) {
  app.classList.add('sidebar-hidden');
  toggleSidebarBtn.title = '显示目录';
} else {
  toggleSidebarBtn.title = '隐藏目录';
}

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

let modalCallback = null;
let confirmCallback = null;

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

let previewHiddenRight = localStorage.getItem('preview-hidden-right') === 'true';
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
  
  currentNote = note;
  noteTitle.value = note.name;
  const content = await ipcRenderer.invoke('read-note', note.path);
  editor.value = content;
  updatePreview(true);
  renderTree();
}

let previewTimeout = null;

function updatePreview(immediate = false) {
  scheduleEditorDecorations(editor, () => currentNote);
  if (previewHiddenLeft && !app.classList.contains('reading-mode')) return;
  if (previewTimeout) clearTimeout(previewTimeout);
  if (!immediate) {
    previewTimeout = setTimeout(() => updatePreview(true), 150);
    return;
  }
  previewTimeout = null;
  const content = editor.value;
  preview.innerHTML = marked.parse(content);
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

    const rect = widget.getBoundingClientRect();
    const distanceRight = Math.abs(rect.right - event.clientX);
    const distanceBottom = Math.abs(rect.bottom - event.clientY);
    const nearRight = distanceRight <= 28;
    const nearBottom = distanceBottom <= 28;
    const showColumn = nearRight && (!nearBottom || distanceRight <= distanceBottom);
    const showRow = nearBottom && (!nearRight || distanceBottom < distanceRight);
    widget.classList.toggle('show-add-column', showColumn);
    widget.classList.toggle('show-add-row', showRow);
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
  const blocks = [];
  let openBlock = null;

  for (let lineNumber = 0; lineNumber < codeMirror.lineCount(); lineNumber += 1) {
    const lineText = codeMirror.getLine(lineNumber);
    if (!/^\s*```/.test(lineText)) continue;
    if (!openBlock) {
      openBlock = {
        start: lineNumber,
        end: codeMirror.lineCount() - 1,
        language: lineText.replace(/^\s*```/, '').trim().split(/\s+/)[0] || '',
        closed: false
      };
    } else {
      openBlock.end = lineNumber;
      openBlock.closed = true;
      blocks.push(openBlock);
      openBlock = null;
    }
  }
  if (openBlock) blocks.push(openBlock);

  editorAdapter.codeBlocks = blocks;
  editorAdapter.decorationStructureDirty = false;
  return blocks;
}

function renderEditorDecorations(editorAdapter, note) {
  if (editorAdapter.renderingDecorations) return;
  editorAdapter.renderingDecorations = true;
  const codeMirror = editorAdapter.codeMirror;
  try {
  codeMirror.operation(() => {
    editorAdapter.decorationMarks.forEach(mark => mark.clear());
    editorAdapter.decorationMarks = [];
    editorAdapter.decorationLines.forEach(item => {
      codeMirror.removeLineClass(item.line, 'wrap', item.className);
    });
    editorAdapter.decorationLines = [];
  });
  if (!note) {
    return;
  }

  const activeLine = codeMirror.getCursor().line;
  const viewport = codeMirror.getViewport();
  const firstLine = Math.max(0, viewport.from - 20);
  const lastLine = Math.min(codeMirror.lineCount(), viewport.to + 20);
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

  function addLineStyle(lineNumber, className) {
    const line = codeMirror.addLineClass(lineNumber, 'wrap', className);
    editorAdapter.decorationLines.push({ line, className });
  }

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
    const fenceLine = /^\s*```/.test(lineText);
    if (lineNumber === activeLine) {
      const activeHeading = lineText.match(/^(#{1,6})\s+/);
      const activeQuote = lineText.match(/^\s*>\s?/);
      let editingClassName = 'cm-editing-source-line';
      if (activeHeading) {
        addLineStyle(lineNumber, 'cm-rendered-heading-line');
        addLineStyle(lineNumber, `cm-rendered-heading-line-${activeHeading[1].length}`);
        editingClassName += ` cm-editing-heading cm-rendered-h${activeHeading[1].length}`;
      }
      if (activeQuote) {
        addLineStyle(lineNumber, 'cm-rendered-quote-line');
        editingClassName += ' cm-editing-quote';
      }
      if (lineText && !inCodeFence && !fenceLine) {
        addMark(
          { line: lineNumber, ch: 0 },
          { line: lineNumber, ch: lineText.length },
          { className: editingClassName }
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
      const widget = document.createElement('span');
      widget.className = 'cm-image-widget';
      widget.title = '图片';
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

      const from = { line: lineNumber, ch: match.index };
      const to = { line: lineNumber, ch: match.index + match[0].length };
      const mark = addMark(from, to, {
        replacedWith: widget,
        atomic: true,
        handleMouseEvents: true
      });
      widget.addEventListener('click', () => {
        codeMirror.focus();
        codeMirror.setCursor(to);
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

    const taskPrefix = lineText.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+/);
    if (taskPrefix) {
      const checkbox = document.createElement('span');
      checkbox.className = 'cm-rendered-checkbox';
      checkbox.classList.toggle('is-checked', taskPrefix[2].toLowerCase() === 'x');
      checkbox.setAttribute('aria-hidden', 'true');
      addMark(
        { line: lineNumber, ch: taskPrefix[1].length },
        { line: lineNumber, ch: taskPrefix[0].length },
        { replacedWith: checkbox }
      );
    } else {
      const listPrefix = lineText.match(/^(\s*)(?:[-*+]\s+|\d+\.\s+)/);
      if (listPrefix) {
        const bullet = document.createElement('span');
        bullet.className = 'cm-rendered-bullet';
        bullet.textContent = '•';
        addMark(
          { line: lineNumber, ch: listPrefix[1].length },
          { line: lineNumber, ch: listPrefix[0].length },
          { replacedWith: bullet }
        );
      }
    }

    const patterns = [
      { regex: /\*\*([^*]+)\*\*/g, open: 2, close: 2, className: 'cm-rendered-strong' },
      { regex: /~~([^~]+)~~/g, open: 2, close: 2, className: 'cm-rendered-strike' },
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
  }
}

function createFencedCodeBlock(code, language = '') {
  const normalizedCode = String(code || '').replace(/\r/g, '').replace(/\n$/, '');
  const backtickRuns = normalizedCode.match(/`+/g) || [];
  const fenceLength = Math.max(3, ...backtickRuns.map(run => run.length + 1));
  const fence = '`'.repeat(fenceLength);
  const safeLanguage = String(language || '').replace(/[^\w+-]/g, '');
  return `\n${fence}${safeLanguage}\n${normalizedCode}\n${fence}\n`;
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
          return (cell.textContent || '').replace(/\s+/g, ' ').trim();
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
    if (/^h[1-6]$/.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n`;
    if (tag === 'li') return content.trim() ? `\n- ${content.trim()}` : '';
    if (['p', 'div', 'section', 'article', 'ul', 'ol'].includes(tag)) return `\n${content.trim()}\n`;
    if (tag === 'strong' || tag === 'b') return `**${content}**`;
    if (tag === 'em' || tag === 'i') return `*${content}*`;
    if (tag === 'code') {
      const delimiter = content.includes('`') ? '``' : '`';
      return `${delimiter}${content}${delimiter}`;
    }
    if (tag === 'a') return `[${content}](${node.getAttribute('href') || ''})`;
    return content;
  }

  return convert(documentNode.body).replace(/\n{3,}/g, '\n\n').trim();
}

function clipboardTextTableToMarkdown(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length || !lines.some(line => line.includes('\t'))) return '';
  const rows = lines.map(line => line.split('\t').map(cell => cell.trim()));
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
    const text = (result.text || clipboardText).trim();
    const clipboardContent = htmlContent || (text ? `${text}\n\n${imageMarkdown}` : imageMarkdown);
    pastedContent = `${needsLeadingBreak ? '\n' : ''}${clipboardContent}${needsTrailingBreak ? '\n' : ''}`;
  } else {
    const htmlSource = clipboardHtml || result.html || '';
    const text = result.text || clipboardText;
    const editorCode = getClipboardEditorCode(event, htmlSource, text);
    const htmlBlock = /<(?:table|pre)[\s>]/i.test(htmlSource)
      ? clipboardHtmlToMarkdown(htmlSource, [])
      : '';
    const textTable = clipboardTextTableToMarkdown(text);
    const structuredContent = htmlBlock || editorCode || textTable;
    if (structuredContent) {
      const needsLeadingBreak = start > 0 && editorElement.value[start - 1] !== '\n';
      const needsTrailingBreak = end < editorElement.value.length
        && editorElement.value[end] !== '\n';
      pastedContent = `${needsLeadingBreak ? '\n\n' : ''}${structuredContent}`
        + `${needsTrailingBreak ? '\n\n' : ''}`;
    } else {
      pastedContent = text;
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

noteTitle.addEventListener('change', async () => {
  if (currentNote) {
    await saveCurrentNote();
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
ipcRenderer.on('save-note', saveCurrentNote);
ipcRenderer.on('export-pdf', exportCurrentNoteToPdf);
ipcRenderer.on('insert-table', insertMarkdownTable);
ipcRenderer.on('insert-code-block', insertMarkdownCodeFence);
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
ipcRenderer.on('toggle-sidebar', toggleSidebar);
ipcRenderer.on('toggle-preview', togglePreviewLeft);
ipcRenderer.on('toggle-theme', toggleColorTheme);

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
  if (previewHiddenRight || rightPanel.style.display === 'none') return;
  if (previewTimeoutRight) clearTimeout(previewTimeoutRight);
  if (!immediate) {
    previewTimeoutRight = setTimeout(() => updatePreviewRight(true), 150);
    return;
  }
  previewTimeoutRight = null;
  const content = editorRight.value;
  previewRight.innerHTML = marked.parse(content);
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
