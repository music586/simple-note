const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');

process.chdir(path.join(__dirname, '..'));
const diagnosticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-workspaces-'));
const userDataPath = path.join(diagnosticRoot, 'user-data');
const firstDirectory = path.join(diagnosticRoot, '工作区甲');
const secondDirectory = path.join(diagnosticRoot, '工作区乙');
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(firstDirectory);
fs.mkdirSync(secondDirectory);
fs.writeFileSync(path.join(firstDirectory, '甲.md'), '甲窗口内容', 'utf8');
fs.writeFileSync(path.join(secondDirectory, '乙.md'), '乙窗口内容', 'utf8');
fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
  notesDir: firstDirectory,
  notesAlias: '甲工作区',
  notesLocations: [
    { path: firstDirectory, alias: '甲工作区' },
    { path: secondDirectory, alias: '乙工作区' }
  ],
  openWindows: [
    { notesDir: firstDirectory, bounds: null, maximized: false },
    { notesDir: secondDirectory, bounds: null, maximized: false }
  ]
}), 'utf8');

app.setPath('userData', userDataPath);
require('../main');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function invoke(window, channel, ...args) {
  return window.webContents.executeJavaScript(`
    require('electron').ipcRenderer.invoke(
      ${JSON.stringify(channel)},
      ...${JSON.stringify(args)}
    )
  `);
}

app.whenReady().then(async () => {
  await wait(500);
  const windows = BrowserWindow.getAllWindows();
  const firstWindow = windows[0];
  const secondWindow = windows[1];

  await invoke(firstWindow, 'switch-notes-dir', firstDirectory);
  await invoke(secondWindow, 'switch-notes-dir', secondDirectory);
  const [firstInfo, secondInfo, firstTree, secondTree] = await Promise.all([
    invoke(firstWindow, 'get-notes-info'),
    invoke(secondWindow, 'get-notes-info'),
    invoke(firstWindow, 'get-tree'),
    invoke(secondWindow, 'get-tree')
  ]);
  const crossRead = await firstWindow.webContents.executeJavaScript(`
    require('electron').ipcRenderer.invoke('read-note', ${JSON.stringify(
      path.join(secondDirectory, '乙.md')
    )}).then(() => 'unexpected-success', error => error.message)
  `);
  const windowMenu = Menu.getApplicationMenu().items.find(item => item.label === '窗口');
  const windowLabels = windowMenu.submenu.items
    .filter(item => /^\d+\./.test(item.label))
    .map(item => item.label);

  process.stdout.write(`${JSON.stringify({
    firstInfo,
    secondInfo,
    firstFiles: firstTree.map(item => item.name),
    secondFiles: secondTree.map(item => item.name),
    restoredWindowCount: windows.length,
    crossReadRejected: crossRead !== 'unexpected-success',
    windowLabels
  }, null, 2)}\n`);
  BrowserWindow.getAllWindows().forEach(window => window.destroy());
  fs.rmSync(diagnosticRoot, { recursive: true, force: true });
  app.quit();
});
