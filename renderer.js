const path = require('path');
const { pathToFileURL } = require('url');
const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');
const CodeMirror = require('codemirror');
require('codemirror/mode/markdown/markdown');

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

const notesList = document.getElementById('notesList');
const editor = createCodeEditor(document.getElementById('editor'));
const preview = document.getElementById('preview');
const noteTitle = document.getElementById('noteTitle');
const newNoteBtn = document.getElementById('newNoteBtn');
const newFolderBtn = document.getElementById('newFolderBtn');
const settingsBtn = document.getElementById('settingsBtn');
const notesDirInfo = document.getElementById('notesDirInfo');
const notesDirDisplay = document.getElementById('notesDirDisplay');
const editorContainer = document.getElementById('editorContainer');

const editorRight = createCodeEditor(document.getElementById('editorRight'));
const previewRight = document.getElementById('previewRight');
const noteTitleRight = document.getElementById('noteTitleRight');
const editorContainerRight = document.getElementById('editorContainerRight');
const rightPanel = document.getElementById('rightPanel');
const leftPanel = document.getElementById('leftPanel');
const panelDivider = document.getElementById('panelDivider');
const closeRightBtn = document.getElementById('closeRightBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const togglePreviewBtnLeft = document.getElementById('togglePreviewBtnLeft');
const themeToggleBtn = document.getElementById('themeToggleBtn');

function scheduleEditorDecorations(editorAdapter, getNote) {
  if (editorAdapter.decorationFrame) return;
  editorAdapter.decorationFrame = requestAnimationFrame(() => {
    editorAdapter.decorationFrame = null;
    renderEditorDecorations(editorAdapter, getNote());
  });
}

editor.codeMirror.on('cursorActivity', () => {
  scheduleEditorDecorations(editor, () => currentNote);
});
editor.codeMirror.on('viewportChange', () => {
  scheduleEditorDecorations(editor, () => currentNote);
});
editorRight.codeMirror.on('cursorActivity', () => {
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
});
editorRight.codeMirror.on('viewportChange', () => {
  scheduleEditorDecorations(editorRight, () => currentNoteRight);
});

function createCodeEditor(textarea) {
  let suppressChange = false;
  const inputHandlers = [];
  const codeMirror = CodeMirror.fromTextArea(textarea, {
    mode: 'markdown',
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 2,
    viewportMargin: 20,
    extraKeys: {
      'Cmd-A': 'selectAll',
      'Ctrl-A': 'selectAll'
    }
  });

  codeMirror.on('change', () => {
    if (!suppressChange) inputHandlers.forEach(handler => handler());
  });

  return {
    codeMirror,
    decorationMarks: [],
    decorationLines: [],
    decorationFrame: null,
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
}

let colorTheme = localStorage.getItem('color-theme') || 'dark';

function applyColorTheme(theme) {
  colorTheme = theme;
  document.documentElement.dataset.theme = theme;
  const nextThemeName = theme === 'dark' ? '浅色' : '深色';
  themeToggleBtn.title = `切换到${nextThemeName}主题`;
  themeToggleBtn.setAttribute('aria-label', `切换到${nextThemeName}主题`);
}

function toggleColorTheme() {
  const nextTheme = colorTheme === 'dark' ? 'light' : 'dark';
  applyColorTheme(nextTheme);
  localStorage.setItem('color-theme', nextTheme);
}

themeToggleBtn.addEventListener('click', toggleColorTheme);

applyColorTheme(colorTheme);

panelDivider.classList.add('hidden');

let previewHiddenLeft = localStorage.getItem('preview-hidden-left') === 'true';

function togglePreviewLeft() {
  previewHiddenLeft = !previewHiddenLeft;
  editorContainer.classList.toggle('preview-hidden', previewHiddenLeft);
  togglePreviewBtnLeft.title = previewHiddenLeft ? '显示预览' : '隐藏预览';
  togglePreviewBtnLeft.classList.toggle('active', !previewHiddenLeft);
  localStorage.setItem('preview-hidden-left', previewHiddenLeft);
  if (!previewHiddenLeft) updatePreview(true);
}

togglePreviewBtnLeft.addEventListener('click', togglePreviewLeft);

if (previewHiddenLeft) {
  editorContainer.classList.add('preview-hidden');
  togglePreviewBtnLeft.title = '显示预览';
  togglePreviewBtnLeft.classList.remove('active');
} else {
  togglePreviewBtnLeft.title = '隐藏预览';
  togglePreviewBtnLeft.classList.add('active');
}

let sidebarHidden = localStorage.getItem('sidebar-hidden') === 'true';
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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && app.classList.contains('zen-mode')) {
    event.preventDefault();
    ipcRenderer.invoke('exit-zen-mode');
  }
});

function toggleSidebar() {
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
  notesDirInfo.title = `${notesInfo.path}\n点击设置别名`;
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
  if (previewHiddenLeft) return;
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

function renderEditorDecorations(editorAdapter, note) {
  const codeMirror = editorAdapter.codeMirror;
  codeMirror.operation(() => {
    editorAdapter.decorationMarks.forEach(mark => mark.clear());
    editorAdapter.decorationMarks = [];
    editorAdapter.decorationLines.forEach(item => {
      codeMirror.removeLineClass(item.line, 'wrap', item.className);
    });
    editorAdapter.decorationLines = [];
  });
  if (!note) return;

  const activeLine = codeMirror.getCursor().line;
  const viewport = codeMirror.getViewport();
  const firstLine = Math.max(0, viewport.from - 20);
  const lastLine = Math.min(codeMirror.lineCount(), viewport.to + 20);
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let inCodeFence = false;

  for (let lineNumber = 0; lineNumber < firstLine; lineNumber += 1) {
    if (/^\s*```/.test(codeMirror.getLine(lineNumber))) inCodeFence = !inCodeFence;
  }

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
    codeMirror.eachLine(firstLine, lastLine, lineHandle => {
      const lineNumber = codeMirror.getLineNumber(lineHandle);
    const lineText = lineHandle.text;
    const fenceLine = /^\s*```/.test(lineText);
    if (lineNumber === activeLine) {
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
    const content = Array.from(node.childNodes).map(convert).join('');
    if (/^h[1-6]$/.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n`;
    if (tag === 'li') return `\n- ${content.trim()}`;
    if (['p', 'div', 'section', 'article', 'ul', 'ol'].includes(tag)) return `\n${content.trim()}\n`;
    if (tag === 'strong' || tag === 'b') return `**${content}**`;
    if (tag === 'em' || tag === 'i') return `*${content}*`;
    if (tag === 'a') return `[${content}](${node.getAttribute('href') || ''})`;
    return content;
  }

  return convert(documentNode.body).replace(/\n{3,}/g, '\n\n').trim();
}

async function pasteImages(event, editorElement, getCurrentNote) {
  event.preventDefault();
  const clipboardText = event.clipboardData?.getData('text/plain') || '';
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
    pastedContent = result.text || clipboardText;
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
  const newDir = await ipcRenderer.invoke('select-notes-dir');
  if (newDir) {
    currentNote = null;
    noteTitle.value = '';
    editor.value = '';
    updatePreview(true);
    expandedFolders.clear();
    await loadTree();
  }
}

function editNotesAlias() {
  const currentAlias = notesDirInfo.dataset.alias || '';
  showModal('设置目录别名', '留空则显示文件夹名称', currentAlias, async (alias) => {
    await ipcRenderer.invoke('set-notes-alias', alias);
    await loadTree();
  });
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

newNoteBtn.addEventListener('click', () => createNewNote(null));
newFolderBtn.addEventListener('click', () => createNewFolder(null));

settingsBtn.addEventListener('click', changeNotesDir);
notesDirInfo.addEventListener('click', editNotesAlias);

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
