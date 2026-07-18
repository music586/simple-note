const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } = require('electron');
const { getImageDirectoryState } = require('./image-directory');

let mainWindow;
let aboutWindow;
let zenMode = false;
let readingMode = false;
const readingWindowStates = new WeakMap();
const iconPath = path.join(__dirname, 'icon.png');

const appName = '简记';
process.title = appName;
app.setName(appName);
const configPath = path.join(app.getPath('userData'), 'config.json');

function getActiveWindow(preferredWindow = null) {
  if (preferredWindow && !preferredWindow.isDestroyed()) return preferredWindow;
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed()) return focusedWindow;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function setZenMode(enabled, updateWindow = true, preferredWindow = null) {
  const targetWindow = getActiveWindow(preferredWindow);
  if (!targetWindow) return;
  if (enabled && readingMode) setReadingMode(false, targetWindow);
  zenMode = enabled;
  if (updateWindow && targetWindow.isFullScreen() !== enabled) {
    targetWindow.setFullScreen(enabled);
  }
  targetWindow.webContents.send('zen-mode-changed', enabled);
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('zen-mode');
  if (menuItem) menuItem.checked = enabled;
}

function setReadingMode(enabled, preferredWindow = null) {
  const targetWindow = getActiveWindow(preferredWindow);
  if (!targetWindow) return;
  if (enabled && zenMode) setZenMode(false, true, targetWindow);
  if (enabled && !readingWindowStates.has(targetWindow)) {
    readingWindowStates.set(targetWindow, {
      wasMaximized: targetWindow.isMaximized(),
      bounds: targetWindow.getBounds()
    });
    if (!targetWindow.isMaximized()) targetWindow.maximize();
  }
  readingMode = enabled;
  targetWindow.webContents.send('reading-mode-changed', enabled);
  if (!enabled) {
    const previousState = readingWindowStates.get(targetWindow);
    if (previousState && !previousState.wasMaximized && !targetWindow.isDestroyed()) {
      targetWindow.unmaximize();
      targetWindow.setBounds(previousState.bounds);
    }
    readingWindowStates.delete(targetWindow);
  }
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('reading-mode');
  if (menuItem) menuItem.checked = enabled;
}

function getConfig() {
  const defaultDir = path.join(app.getPath('userData'), 'notes');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const notesDir = config.notesDir || defaultDir;
    const locations = Array.isArray(config.notesLocations) ? config.notesLocations : [];
    if (!locations.some(location => location.path === notesDir)) {
      locations.push({ path: notesDir, alias: config.notesAlias || '' });
    }
    config.notesDir = notesDir;
    config.notesAlias = config.notesAlias || '';
    config.notesLocations = locations;
    return config;
  }
  return {
    notesDir: defaultDir,
    notesAlias: '',
    notesLocations: [{ path: defaultDir, alias: '' }]
  };
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function getNotesDir() {
  return getConfig().notesDir;
}

function getCurrentImageDirectoryState() {
  const config = getConfig();
  const state = getImageDirectoryState(config, getNotesDir());
  return {
    ...state,
    exists: fs.existsSync(state.effectivePath)
  };
}

function ensureNotesDir() {
  const notesDir = getNotesDir();
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }
}

function showItemInFileManager(itemPath) {
  const notesDir = path.resolve(getNotesDir());
  const resolvedItemPath = path.resolve(itemPath || '');
  const relativePath = path.relative(notesDir, resolvedItemPath);

  if (!itemPath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
  if (!fs.existsSync(resolvedItemPath)) return;

  shell.showItemInFolder(resolvedItemPath);
}

ipcMain.handle('open-external-url', async (event, href) => {
  try {
    const url = new URL(String(href));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { success: false, error: '不支持的链接协议' };
    }
    await shell.openExternal(url.href);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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
    if (item.isDirectory() && item.name === '.obsidian') continue;
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

function sendToActiveWindow(channel, ...args) {
  const activeWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  if (activeWindow && !activeWindow.isDestroyed()) {
    activeWindow.webContents.send(channel, ...args);
  }
}

function createWindow() {
  const newWindow = new BrowserWindow({
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

  mainWindow = newWindow;
  newWindow.loadFile('index.html');
  newWindow.on('page-title-updated', event => {
    event.preventDefault();
    newWindow.setTitle(appName);
  });
  newWindow.on('leave-full-screen', () => {
    if (zenMode) setZenMode(false, false, newWindow);
  });
  newWindow.on('closed', () => {
    if (mainWindow === newWindow) {
      mainWindow = BrowserWindow.getAllWindows().find(window => !window.isDestroyed()) || null;
    }
  });

  const menuTemplate = [
    ...(process.platform === 'darwin' ? [{
      label: appName,
      submenu: [
        { label: `关于${appName}`, click: showAboutWindow },
        { type: 'separator' },
        { label: '设置…', click: () => sendToActiveWindow('open-settings') },
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
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: createWindow
        },
        { type: 'separator' },
        {
          label: '新建笔记',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToActiveWindow('new-note')
        },
        {
          label: '新建文件夹',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendToActiveWindow('new-folder')
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToActiveWindow('save-note')
        },
        {
          label: '导出 PDF…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendToActiveWindow('export-pdf')
        },
        { type: 'separator' },
        {
          label: '修改存储目录',
          click: () => sendToActiveWindow('change-dir')
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
      label: '插入',
      submenu: [
        {
          label: '超链接',
          click: () => sendToActiveWindow('format-markdown', 'insert-link')
        },
        {
          label: '图片',
          click: () => sendToActiveWindow('format-markdown', 'insert-image')
        },
        {
          label: '分割线',
          click: () => sendToActiveWindow('format-markdown', 'insert-rule')
        },
        { type: 'separator' },
        {
          label: '表格',
          accelerator: 'CmdOrCtrl+Alt+T',
          click: () => sendToActiveWindow('insert-table')
        },
        {
          label: '代码块',
          accelerator: 'CmdOrCtrl+Alt+C',
          click: () => sendToActiveWindow('insert-code-block')
        }
      ]
    },
    {
      label: '格式',
      submenu: [
        ...Array.from({ length: 6 }, (_, index) => ({
          label: `小标题 ${index + 1}`,
          click: () => sendToActiveWindow('format-markdown', `heading-${index + 1}`)
        })),
        {
          label: '无小标题',
          click: () => sendToActiveWindow('format-markdown', 'heading-none')
        },
        { type: 'separator' },
        {
          label: '加粗',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToActiveWindow('format-markdown', 'bold')
        },
        {
          label: '倾斜',
          accelerator: 'CmdOrCtrl+I',
          click: () => sendToActiveWindow('format-markdown', 'italic')
        },
        {
          label: '代码块',
          click: () => sendToActiveWindow('format-markdown', 'code-block')
        },
        {
          label: '高亮',
          click: () => sendToActiveWindow('format-markdown', 'highlight')
        },
        { type: 'separator' },
        {
          label: '删除线',
          click: () => sendToActiveWindow('format-markdown', 'strikethrough')
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '折叠/展开侧边栏',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => sendToActiveWindow('toggle-sidebar')
        },
        {
          label: '折叠/展开预览',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendToActiveWindow('toggle-preview')
        },
        {
          label: '切换主题',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendToActiveWindow('toggle-theme')
        },
        {
          id: 'reading-mode',
          type: 'checkbox',
          label: '纯阅读模式',
          click: (menuItem, browserWindow) => setReadingMode(menuItem.checked, browserWindow)
        },
        {
          id: 'zen-mode',
          type: 'checkbox',
          label: '禅模式',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: (menuItem, browserWindow) => setZenMode(menuItem.checked, true, browserWindow)
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

ipcMain.handle('get-image-directory', async () => {
  return { success: true, ...getCurrentImageDirectoryState() };
});

ipcMain.handle('select-image-directory', async event => {
  try {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const state = getCurrentImageDirectoryState();
    const result = await dialog.showOpenDialog(sourceWindow, {
      title: '选择图片文件目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: state.effectivePath
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true, ...getCurrentImageDirectoryState() };
    }

    const config = getConfig();
    config.imageDirectory = path.resolve(result.filePaths[0]);
    saveConfig(config);
    return { success: true, canceled: false, ...getCurrentImageDirectoryState() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('reset-image-directory', async () => {
  try {
    const config = getConfig();
    delete config.imageDirectory;
    saveConfig(config);
    return { success: true, ...getCurrentImageDirectoryState() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-current-pdf', async (event, suggestedName) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) {
    return { success: false, error: '找不到要导出的窗口' };
  }

  const safeName = typeof suggestedName === 'string'
    ? suggestedName.replace(/[\\/:*?"<>|]/g, '-').trim()
    : '';
  const result = await dialog.showSaveDialog(sourceWindow, {
    title: '导出 PDF',
    defaultPath: path.join(app.getPath('documents'), `${safeName || '未命名笔记'}.pdf`),
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };

  try {
    const pdfData = await sourceWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true
    });
    fs.writeFileSync(result.filePath, pdfData);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('exit-zen-mode', async event => {
  if (zenMode) setZenMode(false, true, BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle('exit-reading-mode', async event => {
  if (readingMode) setReadingMode(false, BrowserWindow.fromWebContents(event.sender));
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
  const location = config.notesLocations.find(item => item.path === config.notesDir);
  if (location) location.alias = config.notesAlias;
  saveConfig(config);
  return config.notesAlias;
});

ipcMain.handle('set-location-alias', async (event, { locationPath, alias }) => {
  const config = getConfig();
  const location = config.notesLocations.find(item => item.path === locationPath);
  if (!location) return { success: false, error: '目录不存在' };
  location.alias = typeof alias === 'string' ? alias.trim().slice(0, 60) : '';
  if (config.notesDir === locationPath) config.notesAlias = location.alias;
  saveConfig(config);
  return { success: true };
});

ipcMain.handle('get-notes-locations', async () => {
  const config = getConfig();
  return {
    activePath: config.notesDir,
    locations: config.notesLocations.map(location => ({
      path: location.path,
      alias: location.alias || '',
      name: path.basename(location.path)
    }))
  };
});

ipcMain.handle('select-notes-dir', async event => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(sourceWindow, {
    title: '选择笔记存储目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getNotesDir()
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const config = getConfig();
    config.notesDir = result.filePaths[0];
    let location = config.notesLocations.find(item => item.path === config.notesDir);
    if (!location) {
      location = { path: config.notesDir, alias: '' };
      config.notesLocations.push(location);
    }
    config.notesAlias = location.alias || '';
    saveConfig(config);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('switch-notes-dir', async (event, locationPath) => {
  const config = getConfig();
  const location = config.notesLocations.find(item => item.path === locationPath);
  if (!location) return { success: false, error: '该目录不在已保存列表中' };
  if (!fs.existsSync(location.path)) return { success: false, error: '目录不存在或已被移动' };
  config.notesDir = location.path;
  config.notesAlias = location.alias || '';
  saveConfig(config);
  return { success: true };
});

ipcMain.handle('remove-notes-dir', async (event, locationPath) => {
  const config = getConfig();
  if (config.notesLocations.length <= 1) {
    return { success: false, error: '至少需要保留一个存储目录' };
  }
  config.notesLocations = config.notesLocations.filter(item => item.path !== locationPath);
  if (config.notesDir === locationPath) {
    const nextLocation = config.notesLocations[0];
    config.notesDir = nextLocation.path;
    config.notesAlias = nextLocation.alias || '';
  }
  saveConfig(config);
  return { success: true, activePath: config.notesDir };
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
      return {
        success: true,
        hasImage: false,
        text: clipboard.readText(),
        html: clipboardHtml
      };
    }
    if (imageSources.length > 20) throw new Error('一次最多粘贴 20 张图片');

    const notesDir = path.resolve(getNotesDir());
    const resolvedNotePath = path.resolve(notePath || '');
    const noteRelativePath = path.relative(notesDir, resolvedNotePath);
    if (!notePath || noteRelativePath.startsWith('..') || path.isAbsolute(noteRelativePath)) {
      throw new Error('当前笔记不在存储目录中');
    }

    const config = getConfig();
    const imageDirectory = getImageDirectoryState(config, notesDir);
    const assetsDir = imageDirectory.effectivePath;
    if (imageDirectory.isCustom && !fs.existsSync(assetsDir)) {
      throw new Error('自定义图片目录不存在或已被移动');
    }
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
      label: '在访达中显示',
      click: () => showItemInFileManager(itemPath)
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
      label: '在访达中显示',
      click: () => showItemInFileManager(itemPath)
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

ipcMain.on('show-table-context-menu', (event, data) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) return;

  const sendAction = action => event.sender.send('table-context-action', action);
  const menu = Menu.buildFromTemplate([
    {
      label: '行',
      submenu: [
        { label: '新增行', click: () => sendAction('add-row') },
        {
          label: '删除行',
          enabled: data.rowIndex > 0,
          click: () => sendAction('delete-row')
        }
      ]
    },
    {
      label: '列',
      submenu: [
        { label: '新增列', click: () => sendAction('add-column') },
        {
          label: '删除列',
          enabled: data.columnCount > 1,
          click: () => sendAction('delete-column')
        }
      ]
    }
  ]);
  menu.popup({ window: sourceWindow });
});

ipcMain.on('show-code-language-menu', (event, position) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) return;
  let selected = false;
  const chooseLanguage = language => {
    selected = true;
    event.sender.send('code-language-selected', language);
  };
  const languages = [
    ['纯文本', ''],
    ['JavaScript', 'javascript'],
    ['TypeScript', 'typescript'],
    ['Python', 'python'],
    ['JSON', 'json'],
    ['YAML', 'yaml'],
    ['HTML / XML', 'html'],
    ['CSS', 'css'],
    ['SQL', 'sql'],
    ['Shell / Bash', 'bash'],
    ['Java', 'java'],
    ['C', 'c'],
    ['C++', 'cpp'],
    ['Go', 'go'],
    ['Rust', 'rust'],
    ['Swift', 'swift']
  ];
  const template = languages.map(([label, language]) => ({
    label,
    click: () => chooseLanguage(language)
  }));
  template.splice(1, 0, { type: 'separator' });
  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window: sourceWindow,
    x: Math.max(0, Math.round(position?.x || 0)),
    y: Math.max(0, Math.round(position?.y || 0)),
    callback: () => {
      if (!selected && !event.sender.isDestroyed()) {
        event.sender.send('code-language-selected', null);
      }
    }
  });
});
