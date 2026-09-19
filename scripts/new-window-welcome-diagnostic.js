const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');

process.chdir(path.join(__dirname, '..'));
const diagnosticRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-welcome-'))
);
const userDataPath = path.join(diagnosticRoot, 'user-data');
const notesDirectory = path.join(diagnosticRoot, 'notes');
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(notesDirectory);
if (!process.env.WELCOME_FIRST_RUN) fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
  notesDir: notesDirectory,
  notesLocations: [{ path: notesDirectory, alias: '诊断目录' }]
}), 'utf8');
app.setPath('userData', userDataPath);
require('../main');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  await wait(500);
  const initialWindow = BrowserWindow.getAllWindows()[0];
  const initialWelcome = await initialWindow.webContents.executeJavaScript(
    `!document.getElementById('newWindowWelcome').hidden`
  );
  if (process.env.WELCOME_FIRST_RUN) {
    await initialWindow.webContents.executeJavaScript(
      `document.getElementById('welcomeUseCurrent').click()`
    );
    await wait(500);
    const started = await initialWindow.webContents.executeJavaScript(
      `document.getElementById('newWindowWelcome').hidden && !!currentNote`
    );
    process.stdout.write(JSON.stringify({ firstWelcome: initialWelcome, started }) + '\n');
  }
  const newWindowItem = Menu.getApplicationMenu().items
    .find(item => item.label === '文件').submenu.items
    .find(item => item.label === '新建窗口');
  newWindowItem.click();
  await wait(500);
  const guidedWindow = BrowserWindow.getAllWindows().find(window => window !== initialWindow);
  const guide = await guidedWindow.webContents.executeJavaScript(`(() => {
    const welcome = document.getElementById('newWindowWelcome');
    const result = {
      visible: !welcome.hidden && getComputedStyle(welcome).display !== 'none',
      locationPath: document.getElementById('welcomeStoragePath').textContent,
      chooseFocused: document.activeElement.id === 'welcomeUseCurrent'
    };
    document.getElementById('welcomeUseCurrent').click();
    result.dismissed = welcome.hidden;
    return result;
  })()`);
  await wait(500);
  guide.dismissed = await guidedWindow.webContents.executeJavaScript(
    `document.getElementById('newWindowWelcome').hidden`
  );
  const navigation = await guidedWindow.webContents.executeJavaScript(`(async () => {
    const welcome = document.getElementById('newWindowWelcome');
    await createNewNote(null);
    const notePath = currentNote.path;
    welcome.hidden = false;
    document.querySelector('.tree-file.active').click();
    const sameNote = welcome.hidden && currentNote.path === notePath;
    await createNewNote(null);
    welcome.hidden = false;
    const previous = [...document.querySelectorAll('.tree-file')]
      .find(row => row.dataset.path === notePath);
    previous.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    const otherNote = welcome.hidden && currentNote.path === notePath;
    welcome.hidden = false;
    await createNewNote(null);
    const newNote = welcome.hidden;
    welcome.hidden = false;
    workspaceSessionRestored = false;
    await restoreWorkspaceSession();
    const restoreKeepsWelcome = !welcome.hidden;
    welcome.hidden = false;
    const data = await ipcRenderer.invoke('get-notes-locations');
    await switchNotesLocation(data.activePath);
    const directory = welcome.hidden;
    return { sameNote, otherNote, newNote, restoreKeepsWelcome, directory };
  })()`);
  Object.entries(navigation).forEach(([name, passed]) => assert.equal(passed, true, name));
  guidedWindow.focus();
  await wait(150);
  const reviewMenuVisible = () => Menu.getApplicationMenu()
    .getMenuItemById('ai-resume-layout-review').visible;
  assert.equal(reviewMenuVisible(), false, 'no review hides menu');
  await guidedWindow.webContents.executeJavaScript(`(async () => {
    await createNewNote(null);
    lastActiveEditor = editor;
    syncAiReviewMenuNote();
    const result = await ipcRenderer.invoke('set-ai-review-session', {
      notePath: currentNote.path,
      originalEditorContent: '',
      originalContent: '',
      candidateContent: '# 待审阅',
      selectionStart: 0,
      selectionEnd: 0
    });
    if (!result.success) throw new Error(result.error);
  })()`);
  await wait(150);
  assert.equal(reviewMenuVisible(), true, 'pending review shows menu');
  await guidedWindow.webContents.executeJavaScript(`(async () => {
    window.diagnosticReviewNote = currentNote;
    await createNewNote(null);
    syncAiReviewMenuNote();
  })()`);
  await wait(150);
  assert.equal(reviewMenuVisible(), false, 'note without review hides menu');
  await guidedWindow.webContents.executeJavaScript(`(async () => {
    await selectNote(window.diagnosticReviewNote);
    syncAiReviewMenuNote();
  })()`);
  await wait(150);
  assert.equal(reviewMenuVisible(), true, 'returning to pending note restores menu');
  await guidedWindow.webContents.executeJavaScript(
    `ipcRenderer.invoke('delete-ai-review-session', currentNote.path)`
  );
  assert.equal(reviewMenuVisible(), false, 'discarding review hides menu');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('ai-review-separator').visible, false);
  process.stdout.write('AI review menu checks passed\n');
  newWindowItem.click();
  await wait(500);
  const closeWindow = BrowserWindow.getAllWindows().find(window => (
    window !== initialWindow && window !== guidedWindow
  ));
  await wait(500);
  fs.writeFileSync('/tmp/simple-note-welcome-dark.png', (await closeWindow.webContents.capturePage()).toPNG());
  await closeWindow.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = 'light'`
  );
  await wait(500);
  fs.writeFileSync('/tmp/simple-note-welcome-light.png', (await closeWindow.webContents.capturePage()).toPNG());
  await closeWindow.webContents.executeJavaScript(
    `document.getElementById('welcomeCloseWindow').click()`
  );
  await wait(250);
  const closeWorked = BrowserWindow.getAllWindows().length === 2;
  process.stdout.write(`${JSON.stringify({
    initialWelcome,
    guide,
    navigation,
    closeWorked
  }, null, 2)}\n`);
  BrowserWindow.getAllWindows().forEach(window => window.destroy());
  fs.rmSync(diagnosticRoot, { recursive: true, force: true });
  app.exit(0);
}).catch(err => {
  process.stderr.write(`${err.stack}\n`);
  app.exit(1);
});
