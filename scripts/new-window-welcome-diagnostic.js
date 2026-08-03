const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');

process.chdir(path.join(__dirname, '..'));
const diagnosticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-welcome-'));
const userDataPath = path.join(diagnosticRoot, 'user-data');
const notesDirectory = path.join(diagnosticRoot, 'notes');
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(notesDirectory);
fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
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
      guideCount: document.querySelectorAll('.welcome-guides > div').length,
      chooseFocused: document.activeElement.id === 'welcomeChooseDirectory'
    };
    document.getElementById('welcomeUseCurrent').click();
    result.dismissed = welcome.hidden;
    return result;
  })()`);
  newWindowItem.click();
  await wait(500);
  const closeWindow = BrowserWindow.getAllWindows().find(window => (
    window !== initialWindow && window !== guidedWindow
  ));
  await closeWindow.webContents.executeJavaScript(
    `document.getElementById('welcomeCloseWindow').click()`
  );
  await wait(250);
  const closeWorked = BrowserWindow.getAllWindows().length === 2;
  process.stdout.write(`${JSON.stringify({
    initialWelcome,
    guide,
    closeWorked
  }, null, 2)}\n`);
  BrowserWindow.getAllWindows().forEach(window => window.destroy());
  fs.rmSync(diagnosticRoot, { recursive: true, force: true });
  app.quit();
});
