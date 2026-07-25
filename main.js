const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { fileURLToPath } = require('url');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  clipboard,
  shell,
  screen
} = require('electron');
const { getImageDirectoryState } = require('./image-directory');
const {
  normalizeHiddenDirectory,
  getHiddenDirectories: resolveHiddenDirectories,
  isHiddenDirectory
} = require('./hidden-directory');

let mainWindow;
let aboutWindow;
let zenMode = false;
let readingMode = false;
let notesDirectoryWatcher = null;
let notesTreeRefreshTimer = null;
let topbarHoverTimer = null;
const readingWindowStates = new WeakMap();
const topbarHoverStates = new WeakMap();
const windowColorThemes = new WeakMap();
const windowSidebarStates = new WeakMap();
const windowPreviewStates = new WeakMap();
const iconPath = path.join(__dirname, 'icon.png');
const defaultDeepseekLayoutPrompt = '保证原文的内容，不要随意串改，优化下面的正文排版，'
  + '使用markdown 标签优化展示，和层级结构';
const deepseekTranslationPrompt = `请将以下内容在中文和英文之间进行翻译。

翻译要求：
1. 保持原文含义准确，不进行扩写或删减。
2. 保留关键专业术语、技术名词和行业词汇的原文形式，不强行翻译，例如：
   - 计算机领域：API、SDK、Framework、Runtime、Compiler、Docker、Kubernetes、Git、Frontend、Backend、Database、Agent、LLM、Prompt、Token 等。
   - 产品和工程领域常用术语：Workflow、Pipeline、Architecture、Performance、Scalability 等。
3. 对于专业词汇，可以采用「中文解释 + 英文原词」形式，例如：上下文窗口（Context Window）。
4. 保持代码、变量名、函数名、文件路径、命令、配置项、技术品牌名称不变。
5. 翻译结果要符合目标语言的技术文档表达习惯，避免机械直译。
6. 如果某个词存在多种翻译方式，优先选择技术社区中最常用的表达。

请直接输出翻译结果，不需要解释翻译过程。`;

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

function getHiddenDirectories(config = getConfig()) {
  return resolveHiddenDirectories(config);
}

function getAiOptimizedNotePaths(config) {
  return Array.isArray(config.aiOptimizedNotes)
    ? config.aiOptimizedNotes.filter(notePath => typeof notePath === 'string')
    : [];
}

function migrateAiOptimizedNotePaths(sourcePath, destinationPath = null) {
  const config = getConfig();
  const source = path.resolve(sourcePath);
  const destination = destinationPath ? path.resolve(destinationPath) : null;
  const sourcePrefix = source + path.sep;
  const previousPaths = getAiOptimizedNotePaths(config);
  const nextPaths = previousPaths.flatMap(notePath => {
    const resolvedPath = path.resolve(notePath);
    if (resolvedPath !== source && !resolvedPath.startsWith(sourcePrefix)) {
      return [resolvedPath];
    }
    if (!destination) return [];
    return [path.join(destination, path.relative(source, resolvedPath))];
  });
  const uniquePaths = [...new Set(nextPaths)];
  if (JSON.stringify(previousPaths) === JSON.stringify(uniquePaths)) return;
  config.aiOptimizedNotes = uniquePaths;
  saveConfig(config);
}

function requestDeepSeekLayout(apiKey, prompt, content, systemPrompt = null) {
  const requestBody = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [
      {
        role: 'system',
        content: systemPrompt
          || '只返回优化排版后的完整 Markdown，不要解释，不要使用代码围栏包裹结果。'
      },
      {
        role: 'user',
        content: `${prompt}\n\n${content}`
      }
    ],
    thinking: { type: 'disabled' },
    stream: false
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 120000
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        responseBody += chunk;
        if (responseBody.length > 10 * 1024 * 1024) {
          request.destroy(new Error('DeepSeek 返回内容过大'));
        }
      });
      response.on('end', () => {
        let data;
        try {
          data = JSON.parse(responseBody);
        } catch (err) {
          reject(new Error('DeepSeek 返回了无法解析的响应'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const detail = data?.error?.message;
          reject(new Error(detail || `DeepSeek 请求失败（HTTP ${response.statusCode}）`));
          return;
        }
        const optimizedContent = data?.choices?.[0]?.message?.content;
        if (typeof optimizedContent !== 'string' || !optimizedContent.trim()) {
          reject(new Error('DeepSeek 未返回排版后的内容'));
          return;
        }
        resolve(optimizedContent.trim());
      });
    });
    request.on('timeout', () => request.destroy(new Error('DeepSeek 请求超时，请稍后重试')));
    request.on('error', reject);
    request.end(requestBody);
  });
}

function getNotesDir() {
  return getConfig().notesDir;
}

function validateTemplateDirectory(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    throw new Error('模板目录不存在或已被移动');
  }
  if (!fs.statSync(directoryPath).isDirectory()) throw new Error('模板路径不是文件夹');
  fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.X_OK);
}

function getRawCurrentImageDirectoryState() {
  const config = getConfig();
  const state = getImageDirectoryState(config, getNotesDir());
  return {
    ...state,
    exists: fs.existsSync(state.effectivePath)
  };
}

function getCurrentImageDirectoryState() {
  const state = getRawCurrentImageDirectoryState();
  if (state.isCustom) validateCustomImageDirectory(state.customPath);
  return state;
}

function validateCustomImageDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    throw new Error('自定义图片目录不存在或已被移动');
  }

  let directoryStat;
  try {
    directoryStat = fs.statSync(directoryPath);
  } catch (err) {
    throw new Error('自定义图片目录不存在或无法访问');
  }
  if (!directoryStat.isDirectory()) {
    throw new Error('自定义图片路径不是文件夹');
  }

  try {
    fs.accessSync(directoryPath, fs.constants.W_OK | fs.constants.X_OK);
  } catch (err) {
    throw new Error('自定义图片目录不可进入或写入');
  }
}

function ensureNotesDir() {
  const notesDir = getNotesDir();
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }
}

function notifyNotesTreeChanged() {
  clearTimeout(notesTreeRefreshTimer);
  notesTreeRefreshTimer = setTimeout(() => {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('notes-tree-changed');
    });
  }, 150);
}

function watchNotesDirectory() {
  if (notesDirectoryWatcher) {
    notesDirectoryWatcher.close();
    notesDirectoryWatcher = null;
  }

  ensureNotesDir();
  try {
    notesDirectoryWatcher = fs.watch(getNotesDir(), { recursive: true }, (eventType, fileName) => {
      if (isHiddenDirectory(fileName, getHiddenDirectories())) return;
      notifyNotesTreeChanged();
    });
    notesDirectoryWatcher.on('error', () => {
      notesDirectoryWatcher?.close();
      notesDirectoryWatcher = null;
    });
  } catch (err) {
    notesDirectoryWatcher = null;
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

ipcMain.handle('get-app-version', () => app.getVersion());

function getTree(dir, basePath = '', hiddenDirectories = getHiddenDirectories()) {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const items = fs.readdirSync(dir, { withFileTypes: true }).map(item => ({
    entry: item,
    mtimeMs: fs.statSync(path.join(dir, item.name)).mtimeMs
  }));
  items.sort((a, b) => {
    if (a.entry.isDirectory() && !b.entry.isDirectory()) return -1;
    if (!a.entry.isDirectory() && b.entry.isDirectory()) return 1;
    return b.mtimeMs - a.mtimeMs || a.entry.name.localeCompare(b.entry.name, 'zh-CN');
  });

  for (const { entry: item } of items) {
    const itemPath = path.join(dir, item.name);
    const relativePath = basePath ? path.join(basePath, item.name) : item.name;
    if (item.isDirectory() && isHiddenDirectory(relativePath, hiddenDirectories)) continue;

    if (item.isDirectory()) {
      const children = getTree(itemPath, relativePath, hiddenDirectories);
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

function updateAppearanceMenu(theme) {
  const menu = Menu.getApplicationMenu();
  const lightItem = menu?.getMenuItemById('appearance-light');
  const darkItem = menu?.getMenuItemById('appearance-dark');
  if (lightItem) lightItem.checked = theme === 'light';
  if (darkItem) darkItem.checked = theme === 'dark';
}

function setActiveWindowTheme(theme) {
  updateAppearanceMenu(theme);
  sendToActiveWindow('set-color-theme', theme);
  setImmediate(() => updateAppearanceMenu(theme));
}

function syncActiveWindowAppearanceMenu(window) {
  if (!window || window.isDestroyed()) return;
  const theme = windowColorThemes.get(window);
  if (theme) updateAppearanceMenu(theme);
  window.webContents.send('request-color-theme');
}

function updateVisibilityMenuItems(name, visible) {
  const menu = Menu.getApplicationMenu();
  const collapseItem = menu?.getMenuItemById(`collapse-${name}`);
  const expandItem = menu?.getMenuItemById(`expand-${name}`);
  if (collapseItem) collapseItem.visible = visible;
  if (expandItem) expandItem.visible = !visible;
}

function updateSidebarMenu(visible) {
  updateVisibilityMenuItems('sidebar', visible);
}

function toggleActiveWindowSidebar() {
  const activeWindow = getActiveWindow();
  if (!activeWindow) return;
  const nextVisible = !(windowSidebarStates.get(activeWindow) ?? true);
  windowSidebarStates.set(activeWindow, nextVisible);
  updateSidebarMenu(nextVisible);
  activeWindow.webContents.send('set-sidebar-visibility', nextVisible);
}

function syncActiveWindowSidebarMenu(window) {
  if (!window || window.isDestroyed()) return;
  const visible = windowSidebarStates.get(window);
  if (typeof visible === 'boolean') updateSidebarMenu(visible);
  window.webContents.send('request-sidebar-visibility');
}

function updatePreviewMenu(visible) {
  updateVisibilityMenuItems('preview', visible);
}

function toggleActiveWindowPreview() {
  const activeWindow = getActiveWindow();
  if (!activeWindow) return;
  const nextVisible = !(windowPreviewStates.get(activeWindow) ?? false);
  windowPreviewStates.set(activeWindow, nextVisible);
  updatePreviewMenu(nextVisible);
  activeWindow.webContents.send('set-preview-visibility', nextVisible);
}

function syncActiveWindowPreviewMenu(window) {
  if (!window || window.isDestroyed()) return;
  const visible = windowPreviewStates.get(window);
  if (typeof visible === 'boolean') updatePreviewMenu(visible);
  window.webContents.send('request-preview-visibility');
}

function startTopbarHoverTracking() {
  if (topbarHoverTimer) return;
  topbarHoverTimer = setInterval(() => {
    const cursor = screen.getCursorScreenPoint();
    BrowserWindow.getAllWindows().forEach(window => {
      const bounds = window.getBounds();
      const hovered = window.isVisible() && !window.isMinimized()
        && cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width
        && cursor.y >= bounds.y && cursor.y < bounds.y + 42;
      if (topbarHoverStates.get(window) === hovered) return;
      topbarHoverStates.set(window, hovered);
      if (!window.isDestroyed()) window.webContents.send('topbar-hover-changed', hovered);
    });
  }, 80);
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
      trafficLightPosition: { x: 18, y: 15 }
    } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: iconPath
  });

  mainWindow = newWindow;
  newWindow.loadFile('index.html');
  newWindow.webContents.on('did-finish-load', () => {
    syncActiveWindowAppearanceMenu(newWindow);
    syncActiveWindowSidebarMenu(newWindow);
    syncActiveWindowPreviewMenu(newWindow);
  });
  newWindow.on('page-title-updated', event => {
    event.preventDefault();
    newWindow.setTitle(appName);
  });
  newWindow.on('focus', () => {
    syncActiveWindowAppearanceMenu(newWindow);
    syncActiveWindowSidebarMenu(newWindow);
    syncActiveWindowPreviewMenu(newWindow);
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
          label: '模板…',
          click: () => sendToActiveWindow('insert-template')
        },
        { type: 'separator' },
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
      label: 'AI',
      submenu: [
        {
          label: '优化排版',
          click: () => sendToActiveWindow('ai-optimize-layout')
        },
        {
          label: 'AI 翻译',
          submenu: [
            {
              label: '中文',
              click: () => sendToActiveWindow('ai-translate', 'zh')
            },
            {
              label: '英文',
              click: () => sendToActiveWindow('ai-translate', 'en')
            }
          ]
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          id: 'collapse-sidebar',
          label: '折叠侧边栏',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: toggleActiveWindowSidebar
        },
        {
          id: 'expand-sidebar',
          label: '展开侧边栏',
          accelerator: 'CmdOrCtrl+Shift+B',
          visible: false,
          click: toggleActiveWindowSidebar
        },
        {
          id: 'collapse-preview',
          label: '折叠预览',
          accelerator: 'CmdOrCtrl+Shift+P',
          visible: false,
          click: toggleActiveWindowPreview
        },
        {
          id: 'expand-preview',
          label: '展开预览',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: toggleActiveWindowPreview
        },
        {
          label: '外观',
          submenu: [
            {
              id: 'appearance-light',
              type: 'checkbox',
              label: '明亮',
              click: () => setActiveWindowTheme('light')
            },
            {
              id: 'appearance-dark',
              type: 'checkbox',
              label: '黑暗',
              checked: true,
              click: () => setActiveWindowTheme('dark')
            }
          ]
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
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '更新说明',
          click: () => sendToActiveWindow('open-release-notes', app.getVersion())
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  syncActiveWindowAppearanceMenu(newWindow);
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
  watchNotesDirectory();
  createWindow();
  startTopbarHoverTracking();

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

app.on('before-quit', () => {
  clearTimeout(notesTreeRefreshTimer);
  clearInterval(topbarHoverTimer);
  notesDirectoryWatcher?.close();
});

ipcMain.handle('get-notes-dir', async () => {
  return getNotesDir();
});

ipcMain.on('theme-changed', (event, theme) => {
  if (theme !== 'light' && theme !== 'dark') return;
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (sourceWindow) windowColorThemes.set(sourceWindow, theme);
  if (sourceWindow && getActiveWindow() === sourceWindow) updateAppearanceMenu(theme);
});

ipcMain.on('sidebar-visibility-changed', (event, visible) => {
  if (typeof visible !== 'boolean') return;
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (sourceWindow) windowSidebarStates.set(sourceWindow, visible);
  if (sourceWindow && getActiveWindow() === sourceWindow) updateSidebarMenu(visible);
});

ipcMain.on('preview-visibility-changed', (event, visible) => {
  if (typeof visible !== 'boolean') return;
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (sourceWindow) windowPreviewStates.set(sourceWindow, visible);
  if (sourceWindow && getActiveWindow() === sourceWindow) updatePreviewMenu(visible);
});

ipcMain.handle('get-image-directory', async () => {
  try {
    return { success: true, ...getCurrentImageDirectoryState() };
  } catch (err) {
    try {
      const state = getRawCurrentImageDirectoryState();
      return { success: false, ...state, exists: false, error: err.message };
    } catch (stateErr) {
      return { success: false, error: err.message };
    }
  }
});

ipcMain.handle('get-template-directory', async () => {
  const templateDirectory = getConfig().templateDirectory || '';
  return {
    success: true,
    path: templateDirectory,
    exists: Boolean(templateDirectory && fs.existsSync(templateDirectory))
  };
});

ipcMain.handle('select-template-directory', async event => {
  try {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const currentPath = getConfig().templateDirectory;
    const result = await dialog.showOpenDialog(sourceWindow, {
      title: '选择模板目录',
      properties: ['openDirectory', 'createDirectory'],
      ...(currentPath && fs.existsSync(currentPath) ? { defaultPath: currentPath } : {})
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }
    const selectedPath = path.resolve(result.filePaths[0]);
    validateTemplateDirectory(selectedPath);
    const config = getConfig();
    config.templateDirectory = selectedPath;
    saveConfig(config);
    return { success: true, canceled: false, path: selectedPath, exists: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-template-directory', async () => {
  try {
    const config = getConfig();
    delete config.templateDirectory;
    saveConfig(config);
    return { success: true, path: '', exists: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-hidden-directories', async () => {
  try {
    return { success: true, directories: getHiddenDirectories() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-hidden-directory', async event => {
  try {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const notesDir = path.resolve(getNotesDir());
    const result = await dialog.showOpenDialog(sourceWindow, {
      title: '选择要隐藏的目录',
      buttonLabel: '隐藏此目录',
      properties: ['openDirectory', 'showHiddenFiles'],
      defaultPath: notesDir
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true, directories: getHiddenDirectories() };
    }

    const selectedPath = path.resolve(result.filePaths[0]);
    const relativePath = path.relative(notesDir, selectedPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('只能选择当前笔记库内的子目录');
    }
    if (!fs.existsSync(selectedPath) || !fs.statSync(selectedPath).isDirectory()) {
      throw new Error('所选目录不存在');
    }

    const config = getConfig();
    const directory = normalizeHiddenDirectory(relativePath);
    config.hiddenDirectories = [...new Set([...getHiddenDirectories(config), directory])];
    saveConfig(config);
    notifyNotesTreeChanged();
    return {
      success: true,
      canceled: false,
      directory,
      directories: config.hiddenDirectories
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-hidden-directory', async (event, data) => {
  try {
    if (!data || typeof data !== 'object') throw new Error('隐藏目录参数无效');
    const previousDirectory = normalizeHiddenDirectory(data.previousDirectory);
    const nextDirectory = normalizeHiddenDirectory(data.nextDirectory);
    const config = getConfig();
    const directories = getHiddenDirectories(config);
    const index = directories.indexOf(previousDirectory);
    if (index < 0) throw new Error('隐藏目录不存在');
    directories[index] = nextDirectory;
    config.hiddenDirectories = [...new Set(directories)];
    saveConfig(config);
    notifyNotesTreeChanged();
    return { success: true, directories: config.hiddenDirectories };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('remove-hidden-directory', async (event, directoryPath) => {
  try {
    const directory = normalizeHiddenDirectory(directoryPath);
    const config = getConfig();
    config.hiddenDirectories = getHiddenDirectories(config)
      .filter(item => item !== directory);
    saveConfig(config);
    notifyNotesTreeChanged();
    return { success: true, directories: config.hiddenDirectories };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-templates', async () => {
  try {
    const templateDirectory = getConfig().templateDirectory;
    validateTemplateDirectory(templateDirectory);
    const templates = fs.readdirSync(templateDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
      .map(entry => ({
        name: path.basename(entry.name, path.extname(entry.name)),
        file: entry.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return { success: true, templates };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-template', async (event, fileName) => {
  try {
    if (typeof fileName !== 'string' || path.basename(fileName) !== fileName ||
        path.extname(fileName).toLowerCase() !== '.md') {
      throw new Error('模板名称无效');
    }
    const templateDirectory = getConfig().templateDirectory;
    validateTemplateDirectory(templateDirectory);
    const templatePath = path.join(templateDirectory, fileName);
    if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isFile()) {
      throw new Error('模板不存在或已被移动');
    }
    return { success: true, content: fs.readFileSync(templatePath, 'utf-8') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-image-directory', async event => {
  try {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const state = getRawCurrentImageDirectoryState();
    let pickerDefaultPath = state.defaultPath;
    let stateError = null;
    if (!state.isCustom) {
      pickerDefaultPath = state.effectivePath;
    } else {
      try {
        validateCustomImageDirectory(state.customPath);
        pickerDefaultPath = state.effectivePath;
      } catch (err) {
        pickerDefaultPath = state.defaultPath;
        stateError = err;
      }
    }
    const result = await dialog.showOpenDialog(sourceWindow, {
      title: '选择图片文件目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: pickerDefaultPath
    });

    if (result.canceled || result.filePaths.length === 0) {
      if (stateError) {
        return {
          success: true,
          canceled: true,
          ...state,
          exists: false,
          error: stateError.message
        };
      }
      return { success: true, canceled: true, ...getRawCurrentImageDirectoryState() };
    }

    const selectedPath = path.resolve(result.filePaths[0]);
    validateCustomImageDirectory(selectedPath);
    const config = getConfig();
    config.imageDirectory = selectedPath;
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

ipcMain.handle('get-ai-settings', async () => {
  try {
    const config = getConfig();
    const apiKey = config.deepseekApiKey;
    const layoutPrompt = typeof config.deepseekLayoutPrompt === 'string'
      && config.deepseekLayoutPrompt.trim()
      ? config.deepseekLayoutPrompt
      : defaultDeepseekLayoutPrompt;
    const stampPosition = ['hidden', 'top-right', 'bottom-right', 'corner-ribbon']
      .includes(config.aiStampPosition)
      ? config.aiStampPosition
      : 'top-right';
    return {
      success: true,
      provider: 'deepseek',
      apiKey: typeof apiKey === 'string' ? apiKey : '',
      layoutPrompt,
      stampPosition
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-ai-settings', async (event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') throw new Error('AI 设置格式无效');
    const { apiKey, layoutPrompt } = settings;
    if (typeof apiKey !== 'string') throw new Error('API Key 格式无效');
    const normalizedApiKey = apiKey.trim();
    if (normalizedApiKey.length > 512 || /[\r\n\0]/.test(normalizedApiKey)) {
      throw new Error('API Key 格式无效');
    }
    if (typeof layoutPrompt !== 'string' || !layoutPrompt.trim()) {
      throw new Error('优化排版提示词不能为空');
    }
    const normalizedLayoutPrompt = layoutPrompt.trim();
    if (normalizedLayoutPrompt.length > 4000 || /\0/.test(normalizedLayoutPrompt)) {
      throw new Error('优化排版提示词格式无效');
    }
    const config = getConfig();
    if (normalizedApiKey) config.deepseekApiKey = normalizedApiKey;
    else delete config.deepseekApiKey;
    config.deepseekLayoutPrompt = normalizedLayoutPrompt;
    saveConfig(config);
    return {
      success: true,
      configured: Boolean(normalizedApiKey),
      layoutPrompt: normalizedLayoutPrompt
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-ai-stamp-position', async (event, stampPosition) => {
  try {
    if (!['hidden', 'top-right', 'bottom-right', 'corner-ribbon'].includes(stampPosition)) {
      throw new Error('AI 印章位置无效');
    }
    const config = getConfig();
    config.aiStampPosition = stampPosition;
    saveConfig(config);
    return { success: true, stampPosition };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('deepseek-optimize-layout', async (event, content) => {
  try {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('当前笔记没有可优化的内容');
    }
    const config = getConfig();
    const apiKey = config.deepseekApiKey;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('请先在设置中配置 DeepSeek API Key');
    }
    const layoutPrompt = typeof config.deepseekLayoutPrompt === 'string'
      && config.deepseekLayoutPrompt.trim()
      ? config.deepseekLayoutPrompt
      : defaultDeepseekLayoutPrompt;
    const optimizedContent = await requestDeepSeekLayout(apiKey, layoutPrompt, content);
    return { success: true, content: optimizedContent };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('deepseek-translate', async (event, data) => {
  try {
    if (!data || typeof data !== 'object') throw new Error('翻译参数无效');
    const { targetLanguage, content } = data;
    if (!['zh', 'en'].includes(targetLanguage)) throw new Error('目标语言无效');
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('当前笔记没有可翻译的内容');
    }
    const config = getConfig();
    const apiKey = config.deepseekApiKey;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('请先在设置中配置 DeepSeek API Key');
    }
    const targetName = targetLanguage === 'zh' ? '中文' : '英文';
    const prompt = `${deepseekTranslationPrompt}\n\n目标语言：${targetName}`;
    const translatedContent = await requestDeepSeekLayout(
      apiKey,
      prompt,
      content,
      '只返回翻译后的完整内容，不要解释，不要使用代码围栏包裹结果。'
    );
    return { success: true, content: translatedContent };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-ai-optimized-state', async (event, notePath) => {
  try {
    if (typeof notePath !== 'string' || !notePath) throw new Error('笔记路径无效');
    const resolvedPath = path.resolve(notePath);
    const optimized = getAiOptimizedNotePaths(getConfig())
      .some(storedPath => path.resolve(storedPath) === resolvedPath);
    return { success: true, optimized };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-ai-optimized-state', async (event, { notePath, optimized }) => {
  try {
    if (typeof notePath !== 'string' || !notePath || typeof optimized !== 'boolean') {
      throw new Error('AI 排版状态无效');
    }
    const config = getConfig();
    const resolvedPath = path.resolve(notePath);
    const paths = getAiOptimizedNotePaths(config)
      .map(storedPath => path.resolve(storedPath))
      .filter(storedPath => storedPath !== resolvedPath);
    if (optimized) paths.push(resolvedPath);
    config.aiOptimizedNotes = [...new Set(paths)];
    saveConfig(config);
    return { success: true, optimized };
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
    watchNotesDirectory();
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
  watchNotesDirectory();
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
  watchNotesDirectory();
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
    if (imageDirectory.isCustom) validateCustomImageDirectory(assetsDir);
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
  migrateAiOptimizedNotePaths(notePath);
  return true;
});

ipcMain.handle('delete-folder', async (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
  migrateAiOptimizedNotePaths(folderPath);
  return true;
});

ipcMain.handle('rename-note', async (event, { oldPath, newName }) => {
  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, `${newName}.md`);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }
  migrateAiOptimizedNotePaths(oldPath, newPath);
  return { name: newName, path: newPath, mtime: fs.statSync(newPath).mtime };
});

ipcMain.handle('rename-folder', async (event, { oldPath, newName }) => {
  const parentDir = path.dirname(oldPath);
  const newPath = path.join(parentDir, newName);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }
  migrateAiOptimizedNotePaths(oldPath, newPath);
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
    migrateAiOptimizedNotePaths(sourcePath, newPath);
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

ipcMain.on('show-editor-selection-context-menu', event => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) return;

  const menu = Menu.buildFromTemplate([
    { role: 'cut', label: '剪切' },
    { role: 'copy', label: '复制' },
    { role: 'paste', label: '粘贴' },
    { type: 'separator' },
    {
      label: 'AI 排版',
      click: () => event.sender.send('ai-optimize-layout-selection')
    },
    {
      label: 'AI 翻译',
      submenu: [
        {
          label: '中文',
          click: () => event.sender.send('ai-translate', 'zh')
        },
        {
          label: '英文',
          click: () => event.sender.send('ai-translate', 'en')
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
