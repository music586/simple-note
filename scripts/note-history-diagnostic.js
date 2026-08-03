const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

process.chdir(path.join(__dirname, '..'));
const diagnosticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-history-ui-'));
const userDataPath = path.join(diagnosticRoot, 'user-data');
const notesDirectory = path.join(diagnosticRoot, '笔记');
const notePath = path.join(notesDirectory, '版本测试.md');
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(notesDirectory);
fs.writeFileSync(notePath, '第一版', 'utf8');
fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
  notesDir: notesDirectory,
  notesAlias: '历史测试',
  notesLocations: [{ path: notesDirectory, alias: '历史测试' }]
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
  const window = BrowserWindow.getAllWindows()[0];
  await invoke(window, 'read-note', notePath);
  await invoke(window, 'save-note', {
    notePath,
    content: '第二版',
    historyReason: 'manual-save'
  });
  const history = await invoke(window, 'get-note-history', notePath);
  const baseline = history.versions.find(version => version.reason === 'baseline');
  const metadata = await invoke(window, 'update-note-history-version', {
    notePath,
    versionId: baseline.id,
    label: '里程碑',
    note: '运行诊断',
    pinned: true
  });
  const settings = await invoke(window, 'set-history-settings', {
    bucketMinutes: 10,
    maxVersions: 80,
    maxAgeDays: 365
  });
  const historyUi = await window.webContents.executeJavaScript(`
    (async () => {
      await selectNote(${JSON.stringify({
        type: 'file',
        name: '版本测试.md',
        path: notePath
      })});
      await showNoteHistory();
      const result = {
        open: document.getElementById('noteHistoryModal').classList.contains('active'),
        versions: document.querySelectorAll('.note-history-version').length,
        diffColumns: document.querySelectorAll('#noteHistoryDiff > pre').length,
        metadataControls: Boolean(document.getElementById('noteHistoryPin'))
      };
      hideNoteHistory();
      return result;
    })()
  `);
  const restored = await invoke(window, 'restore-note-history-version', {
    notePath,
    versionId: baseline.id,
    expectedHash: history.currentHash
  });
  const afterRestore = await invoke(window, 'get-note-history', notePath);
  const partialRestore = await invoke(window, 'apply-note-history-selection', {
    notePath,
    expectedHash: afterRestore.currentHash,
    start: '第一版'.length,
    end: '第一版'.length,
    text: '\n局部恢复'
  });
  const historyRoot = path.join(userDataPath, 'history');
  process.stdout.write(`${JSON.stringify({
    historySuccess: history.success,
    metadataSaved: metadata.success && metadata.version.pinned,
    settingsSaved: settings.success && settings.settings.maxVersions === 80,
    historyUi,
    versionReasons: history.versions.map(version => version.reason),
    restored: restored.success,
    partialRestore: partialRestore.success
      && fs.readFileSync(notePath, 'utf8') === '第一版\n局部恢复',
    rollbackAvailable: afterRestore.versions.some(version => version.hash === history.currentHash),
    isolatedStorage: fs.existsSync(historyRoot)
      && !fs.existsSync(path.join(notesDirectory, '.history'))
  }, null, 2)}\n`);
  window.destroy();
  fs.rmSync(diagnosticRoot, { recursive: true, force: true });
  app.quit();
});
