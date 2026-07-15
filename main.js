const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } = require('electron');

let mainWindow;
let aboutWindow;
let zenMode = false;
const iconPath = path.join(__dirname, 'icon.png');

const appName = '简记';
process.title = appName;
app.setName(appName);
const configPath = path.join(app.getPath('userData'), 'config.json');

function setZenMode(enabled, updateWindow = true) {
  zenMode = enabled;
  if (updateWindow && mainWindow.isFullScreen() !== enabled) {
    mainWindow.setFullScreen(enabled);
  }
  mainWindow.webContents.send('zen-mode-changed', enabled);
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('zen-mode');
  if (menuItem) menuItem.checked = enabled;
}

function getConfig() {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return { notesDir: path.join(app.getPath('userData'), 'notes'), notesAlias: '' };
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function getNotesDir() {
  return getConfig().notesDir;
}

function ensureNotesDir() {
  const notesDir = getNotesDir();
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }
}

function getTree(dir, basePath = '') {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    if (!basePath && item.isDirectory() && item.name === 'assets') continue;

    const itemPath = path.join(dir, item.name);
    const relativePath = basePath ? path.join(basePath, item.name) : item.name;

    if (item.isDirectory()) {
      const children = getTree(itemPath, relativePath);
      result.push({
        type: 'folder',
        name: item.name,
        path: itemPath,
        relativePath: relativePath,
        children: children
      });
    } else if (item.isFile() && item.name.endsWith('.md')) {
      const stat = fs.statSync(itemPath);
      result.push({
        type: 'file',
        name: item.name.replace('.md', ''),
        path: itemPath,
        relativePath: relativePath,
        mtime: stat.mtime
      });
    }
  }
  return result;
}

function showAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    width: 480,
    height: 530,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `关于${appName}`,
    backgroundColor: '#f4f5f7',
    parent: mainWindow,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 }
    } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  aboutWindow.loadFile('about.html', {
    query: {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    }
  });
  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: appName,
    backgroundColor: '#151821',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 19 }
    } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: iconPath
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('page-title-updated', event => {
    event.preventDefault();
    mainWindow.setTitle(appName);
  });
  mainWindow.on('leave-full-screen', () => {
    if (zenMode) setZenMode(false, false);
  });

  const menuTemplate = [
    ...(process.platform === 'darwin' ? [{
      label: appName,
      submenu: [
        { label: `关于${appName}`, click: showAboutWindow },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏${appName}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出${appName}` }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建笔记',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('new-note')
        },
        {
          label: '新建文件夹',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => mainWindow.webContents.send('new-folder')
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('save-note')
        },
        { type: 'separator' },
        {
          label: '修改存储目录',
          click: () => mainWindow.webContents.send('change-dir')
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选', accelerator: 'CmdOrCtrl+A' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '切换侧栏',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow.webContents.send('toggle-sidebar')
        },
        {
          label: '切换预览',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => mainWindow.webContents.send('toggle-preview')
        },
        {
          label: '切换主题',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => mainWindow.webContents.send('toggle-theme')
        },
        {
          id: 'zen-mode',
          type: 'checkbox',
          label: '禅模式',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: menuItem => setZenMode(menuItem.checked)
        },
        { type: 'separator' },
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  process.title = appName;
  app.setName(appName);
  app.setAboutPanelOptions({
    applicationName: appName,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    credits: `Electron ${process.versions.electron}\nNode.js ${process.versions.node}`,
    iconPath
  });

  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath);
  }

  ensureNotesDir();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-notes-dir', async () => {
  return getNotesDir();
});

ipcMain.handle('exit-zen-mode', async () => {
  if (zenMode) setZenMode(false);
});

ipcMain.handle('get-notes-info', async () => {
  const config = getConfig();
  return {
    path: config.notesDir,
    alias: config.notesAlias || '',
    name: path.basename(config.notesDir)
  };
});

ipcMain.handle('set-notes-alias', async (event, alias) => {
  const config = getConfig();
  config.notesAlias = typeof alias === 'string' ? alias.trim().slice(0, 60) : '';
  saveConfig(config);
  return config.notesAlias;
});

ipcMain.handle('select-notes-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择笔记存储目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getNotesDir()
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const config = getConfig();
    config.notesDir = result.filePaths[0];
    config.notesAlias = '';
    saveConfig(config);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-tree', async () => {
  ensureNotesDir();
  return getTree(getNotesDir());
});

ipcMain.handle('read-note', async (event, notePath) => {
  return fs.readFileSync(notePath, 'utf-8');
});

ipcMain.handle('save-note', async (event, { notePath, content }) => {
  ensureNotesDir();
  const notesDir = getNotesDir();
  const filePath = notePath || path.join(notesDir, `untitled-${Date.now()}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
});

ipcMain.handle('paste-clipboard-content', async (event, { notePath }) => {
  try {
    const clipboardImage = clipboard.readImage();
    const clipboardHtml = clipboard.readHTML();
    const imageSources = Array.from(clipboardHtml.matchAll(/<img[^>]+src=["']([^"']+)/gi))
      .map(match => match[1].replace(/&amp;/g, '&'));
    if (clipboardImage.isEmpty() && imageSources.length === 0) {
      return { success: true, hasImage: false, text: clipboard.readText() };
    }
    if (imageSources.length > 20) throw new Error('一次最多粘贴 20 张图片');

    const notesDir = path.resolve(getNotesDir());
    const resolvedNotePath = path.resolve(notePath || '');
    const noteRelativePath = path.relative(notesDir, resolvedNotePath);
    if (!notePath || noteRelativePath.startsWith('..') || path.isAbsolute(noteRelativePath)) {
      throw new Error('当前笔记不在存储目录中');
    }

    const assetsDir = path.join(notesDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    async function loadImage(imageSource) {
      if (imageSource.startsWith('data:image/')) {
        const dataMatch = imageSource.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/i);
        if (!dataMatch) throw new Error('不支持该内嵌图片格式');
        const extensionMap = {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/gif': 'gif',
          'image/webp': 'webp'
        };
        return {
          extension: extensionMap[dataMatch[1].toLowerCase()],
          buffer: Buffer.from(dataMatch[2], 'base64')
        };
      }
      if (imageSource.startsWith('file://')) {
        const sourcePath = fileURLToPath(imageSource);
        const sourceExtension = path.extname(sourcePath).slice(1).toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(sourceExtension)) {
          throw new Error('不支持该本地图片格式');
        }
        return {
          extension: sourceExtension === 'jpeg' ? 'jpg' : sourceExtension,
          buffer: fs.readFileSync(sourcePath)
        };
      }

      const sourceUrl = new URL(imageSource);
      if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
        throw new Error('不支持该图片来源');
      }
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      const extensionMap = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp'
      };
      const extension = extensionMap[contentType];
      if (!extension) throw new Error(`不支持该远程图片格式：${contentType || '未知'}`);
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > 20 * 1024 * 1024) throw new Error('图片大小不能超过 20MB');
      return { extension, buffer: Buffer.from(await response.arrayBuffer()) };
    }

    function saveImage(imageBuffer, extension) {
      if (imageBuffer.length === 0) throw new Error('剪贴板中的图片为空');
      if (imageBuffer.length > 20 * 1024 * 1024) throw new Error('图片大小不能超过 20MB');
      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const suffix = crypto.randomBytes(3).toString('hex');
      const imagePath = path.join(assetsDir, `${timestamp}-${suffix}.${extension}`);
      fs.writeFileSync(imagePath, imageBuffer);
      return path.relative(path.dirname(resolvedNotePath), imagePath).split(path.sep).join('/');
    }

    const relativePaths = [];
    if (imageSources.length > 0) {
      const savedSources = new Map();
      for (const imageSource of imageSources) {
        if (!savedSources.has(imageSource)) {
          const imageData = await loadImage(imageSource);
          savedSources.set(imageSource, saveImage(imageData.buffer, imageData.extension));
        }
        relativePaths.push(savedSources.get(imageSource));
      }
    } else {
      relativePaths.push(saveImage(clipboardImage.toPNG(), 'png'));
    }

    return {
      success: true,
      hasImage: true,
      text: clipboard.readText(),
      html: clipboardHtml,
      relativePaths
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('create-note', async (event, { name, folderPath }) => {
  ensureNotesDir();
  const basePath = folderPath || getNotesDir();
  const filePath = path.join(basePath, `${name}.md`);
  fs.writeFileSync(filePath, '', 'utf-8');
  return filePath;
});

ipcMain.handle('create-folder', async (event, { name, parentPath }) => {
  ensureNotesDir();
  const basePath = parentPath || getNotesDir();
  const folderPath = path.join(basePath, name);
  fs.mkdirSync(folderPath, { recursive: true });
  return folderPath;
});

ipcMain.handle('delete-note', async (event, notePath) => {
  if (fs.existsSync(notePath)) {
    fs.unlinkSync(notePath);
  }
  return true;
});

ipcMain.handle('delete-folder', async (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
  return true;
});

ipcMain.handle('rename-note', async (event, { oldPath, newName }) => {
  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, `${newName}.md`);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }
  return { name: newName, path: newPath, mtime: fs.statSync(newPath).mtime };
});

ipcMain.handle('rename-folder', async (event, { oldPath, newName }) => {
  const parentDir = path.dirname(oldPath);
  const newPath = path.join(parentDir, newName);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }
  return { name: newName, path: newPath };
});

ipcMain.handle('move-item', async (event, { sourcePath, targetPath, type }) => {
  const itemName = path.basename(sourcePath);
  let newPath;
  
  if (targetPath === null) {
    newPath = path.join(getNotesDir(), itemName);
  } else {
    newPath = path.join(targetPath, itemName);
  }
  
  if (fs.existsSync(newPath)) {
    return { success: false, error: '目标位置已存在同名文件或文件夹' };
  }
  
  if (sourcePath === newPath) {
    return { success: true, newPath };
  }
  
  if (type === 'folder') {
    if (newPath.startsWith(sourcePath + path.sep)) {
      return { success: false, error: '不能将文件夹移动到其子文件夹中' };
    }
  }
  
  try {
    fs.renameSync(sourcePath, newPath);
    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('show-context-menu', (event, data) => {
  const { type, path: itemPath } = data;
  const template = [];
  
  if (type === 'file') {
    template.push({
      label: '重命名',
      click: () => mainWindow.webContents.send('context-menu-rename', data)
    });
    template.push({
      label: '删除',
      click: () => mainWindow.webContents.send('context-menu-delete', data)
    });
  } else if (type === 'folder') {
    template.push({
      label: '新建笔记',
      click: () => mainWindow.webContents.send('context-menu-new-note', data)
    });
    template.push({
      label: '新建文件夹',
      click: () => mainWindow.webContents.send('context-menu-new-folder', data)
    });
    template.push({ type: 'separator' });
    template.push({
      label: '重命名',
      click: () => mainWindow.webContents.send('context-menu-rename', data)
    });
    template.push({
      label: '删除',
      click: () => mainWindow.webContents.send('context-menu-delete', data)
    });
  } else if (type === 'root') {
    template.push({
      label: '新建笔记',
      click: () => mainWindow.webContents.send('context-menu-new-note', data)
    });
    template.push({
      label: '新建文件夹',
      click: () => mainWindow.webContents.send('context-menu-new-folder', data)
    });
  }
  
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});
