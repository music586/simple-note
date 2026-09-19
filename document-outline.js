const { getDocumentOutline } = require('./markdown-structure');

const outlineGroups = new WeakMap();

function buildOutlineTree(headings) {
  const stack = [];
  const counts = new Map();
  return headings.map(heading => {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const base = JSON.stringify([stack.at(-1)?.key || '', heading.text]);
    const occurrence = counts.get(base) || 0;
    counts.set(base, occurrence + 1);
    const node = {
      ...heading,
      key: `${base}:${occurrence}`,
      ancestors: stack.map(parent => parent.key),
      depth: stack.length,
      hasChildren: false
    };
    if (stack.length) stack.at(-1).hasChildren = true;
    stack.push(node);
    return node;
  });
}

class DocumentOutline {
  constructor({ container, adapter, preview, getNote, navigate, onActivate }) {
    Object.assign(this, { container, adapter, preview, getNote, navigate, onActivate });
    this.editorHost = container.closest('.editor-container');
    this.panel = this.editorHost.closest('.editor-panel');
    this.host = this.panel.closest('.editors-wrapper');
    if (!outlineGroups.has(this.host)) {
      outlineGroups.set(this.host, {
        controllers: [], active: this,
        preference: localStorage.getItem('outline-collapsed') === 'true' ? false : null,
        width: Math.max(200, Math.min(360, Number(localStorage.getItem('outline-width')) || 240))
      });
    }
    this.group = outlineGroups.get(this.host);
    this.group.controllers.push(this);
    this.host.append(container);
    this.nodes = [];
    this.folded = new Set();
    this.signature = '';
    this.activeLine = 0;
    this.manualUntil = 0;
    this.buildShell();
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.host);
    this.panelObserver = new MutationObserver(() => this.layout());
    this.panelObserver.observe(this.panel, { attributes: true, attributeFilter: ['style'] });
    this.panel.addEventListener('pointerdown', () => this.activate());
    this.panel.addEventListener('focusin', () => this.activate());
    adapter.codeMirror.on('focus', () => this.activate());
    this.modeObserver = new MutationObserver(() => this.layout());
    this.modeObserver.observe(document.querySelector('.app'), {
      attributes: true, attributeFilter: ['class']
    });
    container.addEventListener('pointerenter', () => { this.hovering = true; });
    container.addEventListener('pointerleave', () => { this.hovering = false; });
    container.addEventListener('wheel', () => { this.manualUntil = Date.now() + 1800; }, { passive: true });
    container.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.more.open) {
        this.more.open = false;
        this.more.querySelector('summary').focus();
        event.stopPropagation();
      } else if (event.key === 'Escape') {
        this.group.preference = false;
        this.layout();
        this.launcher.focus();
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!container.contains(event.target)) this.more.open = false;
      if (this.group.active === this && !this.docked && this.open &&
          !container.contains(event.target) && !this.launcher.contains(event.target)) {
        this.group.preference = null;
        this.layout();
      }
    });
    adapter.codeMirror.on('scroll', () => this.scheduleFollow(false));
    preview.addEventListener('scroll', () => this.scheduleFollow(true), { passive: true });
  }

  button(text, title, action, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', action);
    return button;
  }

  activate() {
    if (!this.getNote() || this.panel.getBoundingClientRect().width === 0) return;
    if (this.group.active !== this) {
      this.group.active.more.open = false;
      this.group.active = this;
      this.group.controllers.forEach(controller => controller.layout());
    }
    this.onActivate?.();
  }

  buildShell() {
    this.container.replaceChildren();
    const header = document.createElement('div');
    header.className = 'document-outline-title';
    const label = document.createElement('span');
    label.className = 'document-outline-label';
    label.textContent = '大纲';
    this.toggle = this.button('大纲', '展开文档大纲', () => {
      this.group.preference = !this.open;
      localStorage.setItem('outline-collapsed', String(!this.group.preference));
      this.layout();
    }, 'document-outline-collapse');
    this.more = document.createElement('details');
    this.more.className = 'document-outline-more';
    const summary = document.createElement('summary');
    summary.textContent = '···';
    summary.title = '大纲选项';
    summary.setAttribute('aria-label', '大纲选项');
    const actions = document.createElement('div');
    actions.className = 'document-outline-actions';
    [['全部展开', 'expand'], ['全部折叠', 'collapse'], ['展开到二级', 'level2']]
      .forEach(([text, mode]) => actions.append(this.button(text, text, () => {
        this.foldAll(mode);
        this.more.open = false;
        summary.focus();
      })));
    this.more.append(summary, actions);
    this.launcher = this.button('☷', '展开文档大纲', () => {
      this.group.preference = true;
      localStorage.setItem('outline-collapsed', 'false');
      this.layout();
      this.toggle.focus({ preventScroll: true });
    }, 'document-outline-launcher');
    this.host.append(this.launcher);
    header.append(label,
      this.button('◎', '定位当前章节', () => this.select(this.activeLine, true),
        'document-outline-locate'),
      this.more, this.toggle);
    this.noteLabel = document.createElement('div');
    this.noteLabel.className = 'document-outline-note';
    this.list = document.createElement('div');
    this.list.className = 'document-outline-list';
    this.list.id = `${this.container.id}List`;
    this.toggle.setAttribute('aria-controls', this.list.id);
    this.launcher.setAttribute('aria-controls', this.list.id);
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'document-outline-resize';
    this.resizeHandle.tabIndex = 0;
    this.resizeHandle.setAttribute('role', 'separator');
    this.resizeHandle.setAttribute('aria-label', '调整大纲宽度');
    this.resizeHandle.setAttribute('aria-orientation', 'vertical');
    this.resizeHandle.setAttribute('aria-valuemin', '200');
    this.resizeHandle.setAttribute('aria-valuemax', '360');
    this.resizeHandle.addEventListener('pointerdown', event => {
      if (!this.docked || event.button !== 0) return;
      event.preventDefault();
      this.resizeHandle.setPointerCapture(event.pointerId);
    });
    this.resizeHandle.addEventListener('pointermove', event => {
      if (!this.resizeHandle.hasPointerCapture(event.pointerId)) return;
      this.setWidth(this.host.getBoundingClientRect().right - event.clientX);
    });
    this.resizeHandle.addEventListener('pointerup', event => {
      if (this.resizeHandle.hasPointerCapture(event.pointerId)) {
        this.resizeHandle.releasePointerCapture(event.pointerId);
      }
    });
    this.resizeHandle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      this.setWidth(this.group.width + (event.key === 'ArrowLeft' ? 16 : -16));
    });
    this.container.append(this.resizeHandle, header, this.noteLabel, this.list);
    this.layout();
  }

  setWidth(width) {
    this.group.width = Math.max(200, Math.min(360, width));
    localStorage.setItem('outline-width', String(this.group.width));
    this.layout();
  }

  layout() {
    const app = document.querySelector('.app');
    if (this.group.active === this &&
        (!this.getNote() || this.panel.getBoundingClientRect().width === 0)) {
      const next = this.group.controllers.find(controller => controller.getNote() &&
        controller.panel.getBoundingClientRect().width > 0);
      if (next && next !== this) {
        this.group.active = next;
        this.container.hidden = true;
        this.launcher.hidden = true;
        next.layout();
        return;
      }
    }
    this.container.hidden = this.group.active !== this || !this.getNote();
    this.launcher.hidden = this.container.hidden || app.classList.contains('outline-hidden');
    if (this.group.active !== this) return;
    const zen = app.classList.contains('zen-mode');
    if (zen && !this.group.wasZen) {
      this.group.beforeZenPreference = this.group.preference;
      this.group.preference = null;
    } else if (!zen && this.group.wasZen) {
      this.group.preference = this.group.beforeZenPreference;
    }
    this.group.wasZen = zen;
    const available = this.host.clientWidth >= 960 && !zen;
    const nextOpen = this.group.preference ?? available;
    if (this.open !== undefined && nextOpen !== this.open &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clearTimeout(this.group.transitionTimer);
      this.host.classList.add('outline-transitioning');
      this.group.transitionTimer = setTimeout(() => {
        this.host.classList.remove('outline-transitioning');
        this.group.controllers.forEach(controller => controller.adapter.codeMirror.refresh());
      }, 440);
    }
    this.open = nextOpen;
    this.docked = available && this.open;
    this.container.classList.toggle('collapsed', !this.open);
    this.container.classList.toggle('docked', this.docked);
    this.host.classList.toggle('outline-docked', this.docked && !this.container.hidden &&
      !app.classList.contains('outline-hidden'));
    this.host.style.setProperty('--outline-width', `${this.group.width}px`);
    this.resizeHandle.setAttribute('aria-valuenow', String(this.group.width));
    this.resizeHandle.hidden = !this.docked;
    this.container.inert = !this.open;
    this.container.setAttribute('aria-hidden', String(!this.open));
    this.launcher.classList.toggle('visible', !this.open);
    this.launcher.tabIndex = this.open ? -1 : 0;
    this.launcher.setAttribute('aria-expanded', String(this.open));
    this.launcher.setAttribute('aria-hidden', String(this.open));
    this.toggle.textContent = '›';
    this.toggle.title = this.open ? '收起文档大纲' : '展开文档大纲';
    this.toggle.setAttribute('aria-label', this.toggle.title);
    this.toggle.setAttribute('aria-expanded', String(this.open));
    if (!this.open) this.more.open = false;
    this.noteLabel.hidden = this.group.controllers.filter(controller =>
      controller.getNote() && controller.panel.getBoundingClientRect().width > 0).length < 2;
  }

  update() {
    const note = this.getNote();
    const noteKey = note?.path || '';
    this.noteLabel.textContent = note?.name || noteKey.split(/[\\/]/).at(-1)?.replace(/\.md$/, '') || '';
    this.noteLabel.title = this.noteLabel.textContent;
    this.layout();
    const changedNote = this.noteKey !== noteKey;
    if (changedNote) {
      this.noteKey = noteKey;
      try {
        this.folded = new Set(JSON.parse(localStorage.getItem(`outline-folds:${noteKey}`) || '[]'));
      } catch (error) { this.folded = new Set(); }
      this.list.scrollTop = 0;
    }
    const headings = getDocumentOutline(this.adapter.value.split('\n'));
    const signature = JSON.stringify(headings);
    if (!changedNote && this.signature === signature) return;
    const activeKey = this.nodes.findLast(node => node.line <= this.activeLine)?.key;
    const previousScroll = this.list.scrollTop;
    this.signature = signature;
    this.nodes = buildOutlineTree(headings);
    this.render();
    const activeNode = !changedNote && this.nodes.find(node => node.key === activeKey);
    this.select(activeNode ? activeNode.line : this.adapter.codeMirror.getCursor().line);
    if (!changedNote) this.list.scrollTop = previousScroll;
    this.layout();
  }

  persist() {
    localStorage.setItem(`outline-folds:${this.noteKey}`, JSON.stringify([...this.folded]));
  }

  foldAll(mode) {
    this.folded = new Set(this.nodes.filter(node => node.hasChildren && (
      mode === 'collapse' || (mode === 'level2' && node.depth >= 1)
    )).map(node => node.key));
    this.persist();
    this.applyFolds();
    this.select(this.activeLine);
  }

  render() {
    const scrollTop = this.list.scrollTop;
    const focused = this.list.contains(document.activeElement)
      ? { key: document.activeElement.closest('[data-key]')?.dataset.key,
        fold: document.activeElement.classList.contains('document-outline-branch') } : null;
    this.list.replaceChildren();
    if (!this.nodes.length) {
      const empty = document.createElement('div');
      empty.className = 'document-outline-empty';
      empty.textContent = '添加标题，组织你的笔记';
      this.list.append(empty);
    }
    this.nodes.forEach(node => {
      const row = document.createElement('div');
      row.className = 'document-outline-row';
      row.dataset.key = node.key;
      row.style.setProperty('--outline-level', node.depth);
      if (node.hasChildren) {
        const fold = this.button(this.folded.has(node.key) ? '›' : '⌄',
          `${this.folded.has(node.key) ? '展开' : '折叠'} ${node.text}`, () => {
            if (this.folded.has(node.key)) this.folded.delete(node.key);
            else this.folded.add(node.key);
            this.persist();
            this.applyFolds();
            this.select(this.activeLine);
          }, 'document-outline-branch');
        fold.setAttribute('aria-expanded', String(!this.folded.has(node.key)));
        row.append(fold);
      }
      const label = node.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*`_]/g, '').trim();
      const item = this.button(label, label, () => this.jump(node), 'document-outline-item');
      item.dataset.line = String(node.line);
      item.classList.toggle('top-level', node.depth === 0);
      row.append(item);
      this.list.append(row);
    });
    this.applyFolds();
    this.list.scrollTop = scrollTop;
    if (focused) {
      const row = [...this.list.children].find(item => item.dataset.key === focused.key);
      row?.querySelector(focused.fold ? '.document-outline-branch' : '.document-outline-item')
        ?.focus({ preventScroll: true });
    }
  }

  applyFolds() {
    const nodesByKey = new Map(this.nodes.map(node => [node.key, node]));
    this.list.querySelectorAll('.document-outline-row').forEach(row => {
      const node = nodesByKey.get(row.dataset.key);
      row.hidden = node.ancestors.some(key => this.folded.has(key));
      const branch = row.querySelector('.document-outline-branch');
      if (!branch) return;
      const expanded = !this.folded.has(node.key);
      branch.setAttribute('aria-expanded', String(expanded));
      branch.title = `${expanded ? '折叠' : '展开'} ${node.text}`;
      branch.setAttribute('aria-label', branch.title);
    });
  }

  previewHeadings() {
    return [...this.preview.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  }

  jump(node) {
    const reading = document.querySelector('.app').classList.contains('reading-mode') ||
      this.editorHost.classList.contains('view-preview');
    if (reading) {
      const heading = this.previewHeadings()[this.nodes.indexOf(node)];
      if (heading) {
        this.preview.scrollTop += heading.getBoundingClientRect().top -
          this.preview.getBoundingClientRect().top - 24;
        heading.classList.remove('document-outline-target');
        void heading.offsetWidth;
        heading.classList.add('document-outline-target');
      }
    } else this.navigate(this.adapter.codeMirror, node.line);
    this.select(node.line);
    if (!this.docked) {
      this.group.preference = null;
      this.layout();
    }
  }

  scheduleFollow(fromPreview) {
    const reading = document.querySelector('.app').classList.contains('reading-mode') ||
      this.editorHost.classList.contains('view-preview');
    if ((!fromPreview && reading) || (fromPreview && this.preview.clientHeight === 0)) return;
    cancelAnimationFrame(this.followFrame);
    this.followFrame = requestAnimationFrame(() => {
      let line;
      if (fromPreview) {
        const top = this.preview.getBoundingClientRect().top + 48;
        let index = 0;
        this.previewHeadings().forEach((heading, i) => {
          if (heading.getBoundingClientRect().top <= top) index = i;
        });
        line = this.nodes[index]?.line || 0;
      } else {
        const cm = this.adapter.codeMirror;
        line = cm.lineAtHeight(cm.getScrollInfo().top + 48);
      }
      this.select(line);
    });
  }

  select(line, force = false) {
    this.activeLine = line;
    const node = this.nodes.findLast(item => item.line <= line);
    if (force && node) {
      node.ancestors.forEach(key => this.folded.delete(key));
      this.persist();
      this.applyFolds();
    }
    let active = null;
    for (const item of this.list.querySelectorAll('.document-outline-item')) {
      if (!item.parentElement.hidden && Number(item.dataset.line) <= (node?.line ?? -1)) {
        active = item;
      }
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    }
    if (!active) return;
    active.classList.add('active');
    active.setAttribute('aria-current', 'location');
    if (!force && (this.hovering || this.container.contains(document.activeElement) ||
        Date.now() < this.manualUntil)) return;
    const bounds = this.list.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    if (rect.top < bounds.top) this.list.scrollTop -= bounds.top - rect.top + 8;
    else if (rect.bottom > bounds.bottom) this.list.scrollTop += rect.bottom - bounds.bottom + 8;
  }
}

module.exports = { DocumentOutline, buildOutlineTree };
