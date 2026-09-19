const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'outline-ui-')));
app.whenReady().then(async () => {
  ipcMain.handle('rename-note', (event, data) => ({
    success: true, path: data.oldPath, name: data.newName
  }));
  ipcMain.handle('save-note', () => ({ success: true }));
  ipcMain.handle('get-ai-settings', () => ({ success: false }));
  ipcMain.handle('get-tree', () => []);
  ipcMain.handle('get-notes-info', () => ({ path: '', alias: '', name: '' }));
  const window = new BrowserWindow({
    width: 1500, height: 880, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  window.webContents.on('console-message', (event, level, message) => {
    if (level >= 3) console.error(message);
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 180));
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      currentNote = { path: '/tmp/outline-design.md' };
      const content = ['# 一份关于阅读与写作的笔记', '', '从结构开始，让长文更容易阅读。', ''];
      for (let i = 1; i <= 18; i++) {
        content.push('## ' + i + '. 长文阅读：在信息之间建立清晰的联系与层次', '',
          ...Array(8).fill('在记录与思考之间，留出一点空间。'), '',
          '### 观察与记录', '', '把重要的发现写下来。', '');
      }
      editor.codeMirror.setValue(content.join('\\n'));
      editorContainer.classList.add('preview-hidden');
      renderDocumentOutline(editor, documentOutline);
      await wait();
      const controller = documentOutlineControllers.get(documentOutline);
      assert(controller.docked, 'wide outline must dock');
      for (const branch of controller.list.querySelectorAll('.document-outline-branch')) {
        const arrow = branch.getBoundingClientRect();
        const title = branch.parentElement.querySelector('.document-outline-item').getBoundingClientRect();
        assert(Math.abs((arrow.top + arrow.bottom - title.top - title.bottom) / 2) < 1,
          'outline arrow must be centered against its title row');
      }
      const expandedWidth = editorContainer.getBoundingClientRect().width;
      controller.toggle.click();
      await new Promise(resolve => setTimeout(resolve, 70));
      const midPadding = parseFloat(getComputedStyle(controller.host).paddingRight);
      assert(midPadding > 0 && midPadding < controller.group.width, 'sidebar transition has no intermediate layout');
      await new Promise(resolve => setTimeout(resolve, 430));
      assert(getComputedStyle(controller.host).paddingRight === '0px', 'collapsed outline reserves space');
      assert(editorContainer.getBoundingClientRect().width > expandedWidth, 'editor did not reclaim sidebar space');
      assert(controller.launcher.getBoundingClientRect().height <= 32 &&
        getComputedStyle(documentOutline).visibility === 'hidden', 'collapsed outline leaves a full-height rail');
      controller.launcher.click();
      await new Promise(resolve => setTimeout(resolve, 480));
      controller.group.preference = null;
      controller.layout();
      await wait();
      assert(documentOutline.parentElement === document.getElementById('editorsWrapper'), 'outline must survive reading mode');
      const first = controller.list.querySelector('.document-outline-item');
      editor.codeMirror.replaceRange('正文修改', { line: 2, ch: 0 });
      renderDocumentOutline(editor, documentOutline);
      assert(controller.list.querySelector('.document-outline-item') === first, 'body edit rebuilt outline');
      const branch = controller.list.querySelector('.document-outline-branch');
      const expandedTransform = getComputedStyle(branch, '::after').transform;
      branch.click();
      assert(controller.list.querySelector('.document-outline-branch') === branch, 'fold rebuilt arrow');
      assert(controller.list.querySelectorAll('.document-outline-row:not([hidden])').length === 1, 'chapter collapse failed');
      await new Promise(resolve => setTimeout(resolve, 50));
      const midwayTransform = getComputedStyle(branch, '::after').transform;
      await new Promise(resolve => setTimeout(resolve, 180));
      const collapsedTransform = getComputedStyle(branch, '::after').transform;
      assert(midwayTransform !== expandedTransform && midwayTransform !== collapsedTransform,
        'arrow rotation has no intermediate frame');
      controller.foldAll('expand');
      controller.list.scrollTop = 80;
      controller.hovering = true;
      const scroll = controller.list.scrollTop;
      controller.select(220);
      assert(controller.list.scrollTop === scroll, 'following interrupted outline browsing');
      controller.hovering = false;
      controller.select(220, true);
      assert(controller.list.querySelector('.active'), 'active heading missing');
      controller.foldAll('level2');
      const folds = [...controller.folded];
      currentNote = { path: '/tmp/another-outline.md' };
      renderDocumentOutline(editor, documentOutline);
      assert(controller.folded.size === 0, 'fold state leaked to other note');
      currentNote = { path: '/tmp/outline-design.md' };
      renderDocumentOutline(editor, documentOutline);
      assert(JSON.stringify([...controller.folded]) === JSON.stringify(folds), 'fold state lost');
      controller.foldAll('expand');
      controller.select(0, true);
      await wait();
      return { headings: controller.nodes.length, docked: controller.docked, checks: 8 };
    })()`);
    await window.webContents.capturePage().then(image => {
      fs.writeFileSync('/tmp/simple-note-outline-wide.png', image.toPNG());
    });
    window.setSize(820, 780);
    const narrow = await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      const c = documentOutlineControllers.get(documentOutline);
      if (c.docked || c.open) throw new Error('narrow outline must start compact');
      c.toggle.click();
      if (!c.open) throw new Error('narrow outline cannot open');
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    })()`);
    await window.webContents.capturePage().then(image => {
      fs.writeFileSync('/tmp/simple-note-outline-narrow.png', image.toPNG());
    });
    const reading = await window.webContents.executeJavaScript(`(async () => {
      app.classList.add('reading-mode');
      updatePreview(true);
      await new Promise(resolve => setTimeout(resolve, 250));
      const c = documentOutlineControllers.get(documentOutline);
      const cursor = editor.codeMirror.getCursor();
      c.jump(c.nodes[12]);
      await new Promise(resolve => setTimeout(resolve, 500));
      if (preview.scrollTop <= 0) throw new Error('reading navigation did not scroll');
      if (JSON.stringify(cursor) !== JSON.stringify(editor.codeMirror.getCursor())) {
        throw new Error('reading navigation moved editing cursor');
      }
      if (c.activeLine !== c.nodes[12].line) throw new Error('reading highlight does not follow visible section: ' + c.activeLine);
      if (getComputedStyle(documentOutline).display === 'none') throw new Error('reading outline hidden');
      return { scrollTop: preview.scrollTop, active: c.activeLine };
    })()`);
    window.setSize(1500, 880);
    window.show();
    window.focus();
    const split = await window.webContents.executeJavaScript(`(async () => {
      app.classList.remove('reading-mode');
      document.documentElement.dataset.theme = 'light';
      rightPanel.style.display = 'flex';
      currentNoteRight = { path: '/tmp/right-outline.md' };
      editorRight.codeMirror.setValue('# 右侧笔记\\n\\n## 独立章节\\n\\n正文');
      renderDocumentOutline(editorRight, documentOutlineRight);
      await new Promise(resolve => setTimeout(resolve, 220));
      const left = documentOutlineControllers.get(documentOutline);
      const right = documentOutlineControllers.get(documentOutlineRight);
      editorRight.codeMirror.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!right.docked || !documentOutline.hidden || documentOutlineRight.hidden) {
        throw new Error('split panes must share one docked sidebar ' + JSON.stringify({ docked: right.docked, leftHidden: documentOutline.hidden, rightHidden: documentOutlineRight.hidden, active: right.group.active.container.id }));
      }
      const originalWidth = right.group.width;
      right.resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      if (right.group.width !== originalWidth + 16) throw new Error('sidebar width cannot change');
      right.setWidth(originalWidth);
      right.more.open = true;
      right.more.querySelector('button').click();
      if (right.more.open) throw new Error('outline options did not close');
      right.foldAll('collapse');
      if (right.folded.size !== 1 || left.folded.size !== 0) throw new Error('split fold states leaked');
      editor.codeMirror.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (documentOutline.hidden || !documentOutlineRight.hidden) throw new Error('active outline did not switch');
      previewRight.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 180));
      return true;
    })()`);
    await window.webContents.capturePage().then(image => {
      fs.writeFileSync('/tmp/simple-note-outline-split-light.png', image.toPNG());
    });
    const fallback = await window.webContents.executeJavaScript(`(async () => {
      rightPanel.style.display = 'none';
      await new Promise(resolve => setTimeout(resolve, 100));
      if (documentOutline.hidden || !documentOutlineRight.hidden) throw new Error('closed right pane still owns outline');
      app.classList.add('outline-hidden');
      await new Promise(resolve => setTimeout(resolve, 100));
      if (document.getElementById('editorsWrapper').classList.contains('outline-docked')) {
        throw new Error('hidden outline reserved editor space');
      }
      return true;
    })()`);
    const rapid = await window.webContents.executeJavaScript(`(async () => {
      app.classList.remove('outline-hidden');
      const c = documentOutlineControllers.get(documentOutline);
      c.group.preference = true;
      c.layout();
      await new Promise(resolve => setTimeout(resolve, 480));
      c.toggle.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      c.launcher.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      c.toggle.click();
      await new Promise(resolve => setTimeout(resolve, 480));
      if (c.open || getComputedStyle(c.host).paddingRight !== '0px' || !c.container.inert) {
        throw new Error('rapid toggling left stale outline state');
      }
      return true;
    })()`);
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    const reducedMotion = await window.webContents.executeJavaScript(`(() => {
      const c = documentOutlineControllers.get(documentOutline);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) throw new Error('media emulation failed');
      c.launcher.click();
      if (parseFloat(getComputedStyle(c.host).paddingRight) !== c.group.width) {
        throw new Error('reduced-motion opening still animates ' + JSON.stringify({ padding: getComputedStyle(c.host).paddingRight, width: c.group.width, open: c.open, docked: c.docked, classes: c.host.className, transition: getComputedStyle(c.host).transition, active: c.group.active.container.id }));
      }
      c.toggle.click();
      if (getComputedStyle(c.host).paddingRight !== '0px') {
        throw new Error('reduced-motion closing still animates');
      }
      return true;
    })()`);
    console.log(JSON.stringify({ result, narrow, reading, split, fallback, rapid, reducedMotion }));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
