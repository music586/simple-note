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
  screen,
  nativeTheme
} = require('electron');
const { getImageDirectoryState } = require('./image-directory');
const { NoteHistoryStore, hashContent } = require('./note-history');
const {
  isPathInside,
  resolveLibraryPath,
  validateEntryName,
  writeFileAtomically
} = require('./note-path-security');
const {
  normalizeHiddenDirectory,
  getHiddenDirectories: resolveHiddenDirectories,
  isHiddenDirectory
} = require('./hidden-directory');

let mainWindow;
let aboutWindow;
let zenMode = false;
let readingMode = false;
let topbarHoverTimer = null;
const readingWindowStates = new WeakMap();
const topbarHoverStates = new WeakMap();
const windowColorThemes = new WeakMap();
const windowSidebarStates = new WeakMap();
const windowPreviewStates = new WeakMap();
const windowEditorHistoryStates = new WeakMap();
const windowWorkspaces = new Map();
let nextWorkspaceId = 1;
let windowSessionSaveTimer = null;
let isQuitting = false;
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

function isWindowUsable(targetWindow) {
  return Boolean(
    targetWindow
    && !targetWindow.isDestroyed()
    && targetWindow.webContents
    && !targetWindow.webContents.isDestroyed()
  );
}

function sendToWindow(targetWindow, channel, ...args) {
  if (!isWindowUsable(targetWindow) || isQuitting) return false;
  try {
    targetWindow.webContents.send(channel, ...args);
    return true;
  } catch (err) {
    return false;
  }
}

function setZenMode(enabled, updateWindow = true, preferredWindow = null) {
  const targetWindow = getActiveWindow(preferredWindow);
  if (!targetWindow) return;
  if (enabled && readingMode) setReadingMode(false, targetWindow);
  zenMode = enabled;
  if (updateWindow && targetWindow.isFullScreen() !== enabled) {
    targetWindow.setFullScreen(enabled);
  }
  sendToWindow(targetWindow, 'zen-mode-changed', enabled);
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('zen-mode');
  if (menuItem) menuItem.checked = enabled;
}

function restoreReadingWindowState(targetWindow) {
  const previousState = readingWindowStates.get(targetWindow);
  if (!previousState) return;

  readingWindowStates.delete(targetWindow);
  if (targetWindow.isDestroyed()) return;
  if (previousState.wasMaximized) {
    if (!targetWindow.isMaximized()) targetWindow.maximize();
  } else {
    if (targetWindow.isMaximized()) targetWindow.unmaximize();
    targetWindow.setBounds(previousState.bounds);
  }
}

function setReadingMode(enabled, preferredWindow = null) {
  const targetWindow = getActiveWindow(preferredWindow);
  if (!targetWindow) return;
  if (enabled && zenMode) setZenMode(false, false, targetWindow);
  if (enabled && !readingWindowStates.has(targetWindow)) {
    readingWindowStates.set(targetWindow, {
      wasMaximized: targetWindow.isMaximized(),
      bounds: targetWindow.getBounds()
    });
  }
  readingMode = enabled;
  sendToWindow(targetWindow, 'reading-mode-changed', enabled);
  if (enabled && !targetWindow.isFullScreen()) {
    targetWindow.setFullScreen(true);
  } else if (!enabled && targetWindow.isFullScreen()) {
    targetWindow.setFullScreen(false);
  } else if (!enabled) {
    restoreReadingWindowState(targetWindow);
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

function getPersistedWindowSessions(config = getConfig()) {
  const sessions = Array.isArray(config.openWindows)
    ? config.openWindows.filter(session => session && typeof session.notesDir === 'string')
    : [];
  return sessions.slice(0, 20).map(session => ({
    notesDir: fs.existsSync(session.notesDir) && fs.statSync(session.notesDir).isDirectory()
      ? path.resolve(session.notesDir)
      : config.notesDir,
    bounds: session.bounds && ['x', 'y', 'width', 'height'].every(key => (
      Number.isFinite(session.bounds[key])
    )) ? session.bounds : null,
    maximized: Boolean(session.maximized)
  }));
}

function persistWindowSessions() {
  const config = getConfig();
  config.openWindows = BrowserWindow.getAllWindows().flatMap(window => {
    if (window.isDestroyed() || !windowWorkspaces.has(window)) return [];
    try {
      return [{
        notesDir: getNotesDir(window),
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized()
      }];
    } catch (err) {
      return [];
    }
  });
  saveConfig(config);
}

function scheduleWindowSessionSave() {
  if (isQuitting) return;
  if (windowSessionSaveTimer) clearTimeout(windowSessionSaveTimer);
  windowSessionSaveTimer = setTimeout(() => {
    windowSessionSaveTimer = null;
    persistWindowSessions();
  }, 200);
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

const aiProviders = {
  deepseek: {
    name: 'DeepSeek',
    hostname: 'api.deepseek.com',
    path: '/chat/completions',
    model: 'deepseek-v4-flash',
    extras: { thinking: { type: 'disabled' } }
  },
  mimo: {
    name: 'MiMo',
    hostname: 'api.xiaomimimo.com',
    path: '/v1/chat/completions',
    model: 'mimo-v2.5-pro',
    extras: { thinking: { type: 'disabled' } }
  },
  hunyuan: {
    name: '腾讯混元',
    hostname: 'tokenhub.tencentmaas.com',
    path: '/v1/chat/completions',
    model: 'hy3',
    extras: {}
  }
};

function getAiProviderHttpError(providerId, statusCode, detail, action) {
  if (providerId === 'hunyuan' && statusCode === 401) {
    return new Error(
      '腾讯混元 TokenHub API Key 无效或已失效，请在 TokenHub 控制台重新创建 API Key，'
        + '并确认已为 Hy3 开启免费体验或后付费'
    );
  }
  const provider = aiProviders[providerId];
  return new Error(detail || `${provider.name} ${action}失败（HTTP ${statusCode}）`);
}

function requestAiLayout(providerId, apiKey, prompt, content, systemPrompt = null) {
  const provider = aiProviders[providerId] || aiProviders.deepseek;
  const requestBody = JSON.stringify({
    model: provider.model,
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
    stream: false,
    ...provider.extras
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: provider.hostname,
      path: provider.path,
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
          request.destroy(new Error(`${provider.name} 返回内容过大`));
        }
      });
      response.on('end', () => {
        let data;
        try {
          data = JSON.parse(responseBody);
        } catch (err) {
          reject(new Error(`${provider.name} 返回了无法解析的响应`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const detail = data?.error?.message_zh || data?.error?.message;
          reject(getAiProviderHttpError(
            providerId,
            response.statusCode,
            detail,
            '请求'
          ));
          return;
        }
        const optimizedContent = data?.choices?.[0]?.message?.content;
        if (typeof optimizedContent !== 'string' || !optimizedContent.trim()) {
          reject(new Error(`${provider.name} 未返回处理后的内容`));
          return;
        }
        resolve(optimizedContent.trim());
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`${provider.name} 请求超时，请稍后重试`));
    });
    request.on('error', reject);
    request.end(requestBody);
  });
}

function testAiApiKey(providerId, apiKey) {
  const provider = aiProviders[providerId];
  const tokenLimit = providerId === 'mimo'
    ? { max_completion_tokens: 1 }
    : { max_tokens: 1 };
  const requestBody = JSON.stringify({
    model: provider.model,
    messages: [{ role: 'user', content: '1' }],
    stream: false,
    ...tokenLimit,
    ...provider.extras
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: provider.hostname,
      path: provider.path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 30000
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(responseBody);
        } catch (err) {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(getAiProviderHttpError(
            providerId,
            response.statusCode,
            data?.error?.message_zh || data?.error?.message,
            '验证'
          ));
          return;
        }
        resolve();
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`${provider.name} 验证超时，请稍后重试`));
    });
    request.on('error', reject);
    request.end(requestBody);
  });
}

function getWorkspaceWindow(source = null) {
  if (source instanceof BrowserWindow) return source;
  if (source?.sender) return BrowserWindow.fromWebContents(source.sender);
  return null;
}

function getWindowWorkspace(source = null) {
  const targetWindow = getWorkspaceWindow(source);
  if (!targetWindow || targetWindow.isDestroyed()) return null;
  let workspace = windowWorkspaces.get(targetWindow);
  if (!workspace) {
    workspace = {
      id: nextWorkspaceId++,
      notesDir: getConfig().notesDir,
      watcher: null,
      refreshTimer: null,
      historyStore: null
    };
    windowWorkspaces.set(targetWindow, workspace);
  }
  return workspace;
}

function getNotesDir(source = null) {
  return getWindowWorkspace(source)?.notesDir || getConfig().notesDir;
}

function setWindowNotesDir(source, notesDir) {
  const workspace = getWindowWorkspace(source);
  if (!workspace) return;
  workspace.notesDir = path.resolve(notesDir);
  workspace.historyStore = null;
  scheduleWindowSessionSave();
}

function getHistoryStore(source) {
  const workspace = getWindowWorkspace(source);
  if (!workspace) throw new Error('找不到当前窗口工作区');
  if (!workspace.historyStore) {
    workspace.historyStore = new NoteHistoryStore({
      historyRoot: path.join(app.getPath('userData'), 'history'),
      workspacePath: workspace.notesDir
    });
  }
  return workspace.historyStore;
}

function resolveNotesPath(source, inputPath, options = {}) {
  ensureNotesDir(source);
  return resolveLibraryPath(getNotesDir(source), inputPath, options);
}

function validateTemplateDirectory(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    throw new Error('模板目录不存在或已被移动');
  }
  if (!fs.statSync(directoryPath).isDirectory()) throw new Error('模板路径不是文件夹');
  fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.X_OK);
}

function getRawCurrentImageDirectoryState(source = null) {
  const config = getConfig();
  const state = getImageDirectoryState(config, getNotesDir(source));
  return {
    ...state,
    exists: fs.existsSync(state.effectivePath)
  };
}

function getCurrentImageDirectoryState(source = null) {
  const state = getRawCurrentImageDirectoryState(source);
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

function ensureNotesDir(source = null) {
  const notesDir = getNotesDir(source);
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }
}

function notifyNotesTreeChanged(source = null) {
  const targetWindow = getWorkspaceWindow(source);
  if (!targetWindow) {
    BrowserWindow.getAllWindows().forEach(window => notifyNotesTreeChanged(window));
    return;
  }
  const workspace = getWindowWorkspace(targetWindow);
  if (!workspace || isQuitting) return;
  clearTimeout(workspace.refreshTimer);
  workspace.refreshTimer = setTimeout(() => {
    workspace.refreshTimer = null;
    sendToWindow(targetWindow, 'notes-tree-changed');
  }, 150);
}

function closeWorkspaceWatcher(workspace) {
  if (!workspace) return;
  clearTimeout(workspace.refreshTimer);
  workspace.refreshTimer = null;
  const watcher = workspace.watcher;
  workspace.watcher = null;
  if (!watcher) return;
  try {
    watcher.close();
  } catch (err) {
    // The operating system may finalize the watcher while the app is quitting.
  }
}

function watchNotesDirectory(source) {
  const targetWindow = getWorkspaceWindow(source);
  if (!targetWindow) return;
  const workspace = getWindowWorkspace(targetWindow);
  closeWorkspaceWatcher(workspace);

  ensureNotesDir(targetWindow);
  try {
    workspace.watcher = fs.watch(
      getNotesDir(targetWindow),
      { recursive: true },
      (eventType, fileName) => {
      if (isHiddenDirectory(fileName, getHiddenDirectories())) return;
      notifyNotesTreeChanged(targetWindow);
    });
    workspace.watcher.on('error', () => {
      closeWorkspaceWatcher(workspace);
    });
  } catch (err) {
    workspace.watcher = null;
  }
}

function showItemInFileManager(source, itemPath) {
  const notesDir = path.resolve(getNotesDir(source));
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

ipcMain.handle('open-application-url', async (event, href) => {
  try {
    const target = String(href || '').trim();
    if (!target || target.length > 2048 || /[\r\n\0]/.test(target)) {
      throw new Error('应用链接格式无效');
    }
    const url = new URL(target);
    if (
      !/^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
      || ['http:', 'https:', 'file:', 'javascript:', 'data:'].includes(url.protocol)
    ) {
      throw new Error('不支持的应用链接协议');
    }
    await shell.openExternal(url.href);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-relative-link', async (event, data) => {
  try {
    const notesDir = path.resolve(getNotesDir(event));
    const sourceNotePath = path.resolve(String(data?.sourceNotePath || ''));
    const sourceRelativePath = path.relative(notesDir, sourceNotePath);
    if (
      !data
      || typeof data.href !== 'string'
      || sourceRelativePath.startsWith('..')
      || path.isAbsolute(sourceRelativePath)
    ) {
      throw new Error('相对链接来源无效');
    }

    const linkPath = decodeURI(data.href.split(/[?#]/, 1)[0]).trim();
    if (!linkPath) return { success: false, error: '相对链接目标为空' };
    const targetPath = path.resolve(path.dirname(sourceNotePath), linkPath);
    const targetRelativePath = path.relative(notesDir, targetPath);
    if (targetRelativePath.startsWith('..') || path.isAbsolute(targetRelativePath)) {
      throw new Error('相对链接不能指向笔记库外部');
    }
    if (!fs.existsSync(targetPath)) throw new Error('相对链接目标不存在');

    if (path.extname(targetPath).toLowerCase() === '.md') {
      return { success: true, type: 'note', path: targetPath };
    }
    const error = await shell.openPath(targetPath);
    if (error) throw new Error(error);
    return { success: true, type: 'file', path: targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

function getFolderOrder(config, notesDir) {
  const workspaceOrders = config.folderOrders?.[path.resolve(notesDir)];
  return workspaceOrders && typeof workspaceOrders === 'object' ? workspaceOrders : {};
}

function getTree(
  dir,
  basePath = '',
  hiddenDirectories = getHiddenDirectories(),
  folderOrder = {}
) {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const items = fs.readdirSync(dir, { withFileTypes: true }).map(item => ({
    entry: item,
    mtimeMs: fs.statSync(path.join(dir, item.name)).mtimeMs
  }));
  const orderedNames = Array.isArray(folderOrder[basePath]) ? folderOrder[basePath] : [];
  const folderOrderIndexes = new Map(orderedNames.map((name, index) => [name, index]));
  items.sort((a, b) => {
    if (a.entry.isDirectory() && !b.entry.isDirectory()) return -1;
    if (!a.entry.isDirectory() && b.entry.isDirectory()) return 1;
    if (a.entry.isDirectory() && b.entry.isDirectory() && orderedNames.length > 0) {
      const aIndex = folderOrderIndexes.get(a.entry.name);
      const bIndex = folderOrderIndexes.get(b.entry.name);
      if (aIndex !== undefined || bIndex !== undefined) {
        if (aIndex === undefined) return 1;
        if (bIndex === undefined) return -1;
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
    }
    return b.mtimeMs - a.mtimeMs || a.entry.name.localeCompare(b.entry.name, 'zh-CN');
  });

  for (const { entry: item } of items) {
    const itemPath = path.join(dir, item.name);
    const relativePath = basePath ? path.join(basePath, item.name) : item.name;
    if (item.isDirectory() && isHiddenDirectory(relativePath, hiddenDirectories)) continue;

    if (item.isDirectory()) {
      const children = getTree(itemPath, relativePath, hiddenDirectories, folderOrder);
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
  sendToWindow(activeWindow, channel, ...args);
}

function updateAppearanceMenu(theme) {
  const menu = Menu.getApplicationMenu();
  const systemItem = menu?.getMenuItemById('appearance-system');
  const lightItem = menu?.getMenuItemById('appearance-light');
  const darkItem = menu?.getMenuItemById('appearance-dark');
  if (systemItem) systemItem.checked = theme === 'system';
  if (lightItem) lightItem.checked = theme === 'light';
  if (darkItem) darkItem.checked = theme === 'dark';
}

function setActiveWindowTheme(theme) {
  updateAppearanceMenu(theme);
  sendToActiveWindow(
    'set-color-theme',
    theme,
    nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  );
  setImmediate(() => updateAppearanceMenu(theme));
}

function broadcastSystemColorTheme() {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  BrowserWindow.getAllWindows().forEach(window => {
    sendToWindow(window, 'system-color-theme-changed', theme);
  });
}

function syncActiveWindowAppearanceMenu(window) {
  if (!window || window.isDestroyed()) return;
  const theme = windowColorThemes.get(window);
  if (theme) updateAppearanceMenu(theme);
  sendToWindow(window, 'request-color-theme');
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
  sendToWindow(activeWindow, 'set-sidebar-visibility', nextVisible);
}

function syncActiveWindowSidebarMenu(window) {
  if (!window || window.isDestroyed()) return;
  const visible = windowSidebarStates.get(window);
  if (typeof visible === 'boolean') updateSidebarMenu(visible);
  sendToWindow(window, 'request-sidebar-visibility');
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
  sendToWindow(activeWindow, 'set-preview-visibility', nextVisible);
}

function syncActiveWindowPreviewMenu(window) {
  if (!window || window.isDestroyed()) return;
  const visible = windowPreviewStates.get(window);
  if (typeof visible === 'boolean') updatePreviewMenu(visible);
  sendToWindow(window, 'request-preview-visibility');
}

function updateEditorHistoryMenu(state = {}) {
  const menu = Menu.getApplicationMenu();
  const undoItem = menu?.getMenuItemById('editor-undo');
  const redoItem = menu?.getMenuItemById('editor-redo');
  if (undoItem) {
    undoItem.enabled = Boolean(state.canUndo);
    undoItem.label = state.canUndo && state.undoLabel
      ? `撤销“${state.undoLabel}”`
      : '撤销';
  }
  if (redoItem) {
    redoItem.enabled = Boolean(state.canRedo);
    redoItem.label = state.canRedo && state.redoLabel
      ? `重做“${state.redoLabel}”`
      : '重做';
  }
}

function syncActiveWindowEditorHistoryMenu(window) {
  if (!window || window.isDestroyed()) return;
  updateEditorHistoryMenu(windowEditorHistoryStates.get(window));
  sendToWindow(window, 'request-editor-history-state');
}

function startTopbarHoverTracking() {
  if (topbarHoverTimer) return;
  topbarHoverTimer = setInterval(() => {
    if (isQuitting) return;
    const cursor = screen.getCursorScreenPoint();
    BrowserWindow.getAllWindows().forEach(window => {
      if (!isWindowUsable(window)) return;
      try {
        const bounds = window.getBounds();
        const hovered = window.isVisible() && !window.isMinimized()
          && cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width
          && cursor.y >= bounds.y && cursor.y < bounds.y + 42;
        if (topbarHoverStates.get(window) === hovered) return;
        topbarHoverStates.set(window, hovered);
        sendToWindow(window, 'topbar-hover-changed', hovered);
      } catch (err) {
        topbarHoverStates.delete(window);
      }
    });
  }, 80);
}

function createWindow(session = {}) {
  const initialBounds = session.bounds || {};
  const newWindow = new BrowserWindow({
    width: initialBounds.width || 1200,
    height: initialBounds.height || 800,
    ...(Number.isFinite(initialBounds.x) && Number.isFinite(initialBounds.y) ? {
      x: initialBounds.x,
      y: initialBounds.y
    } : {}),
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

  const workspace = getWindowWorkspace(newWindow);
  if (session.notesDir) workspace.notesDir = path.resolve(session.notesDir);
  mainWindow = newWindow;
  newWindow.loadFile(path.join(__dirname, 'index.html'), session.showWelcome ? {
    query: { welcome: '1' }
  } : undefined);
  newWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  newWindow.webContents.on('will-navigate', event => event.preventDefault());
  newWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape' || !newWindow.isFullScreen()) return;
    event.preventDefault();
    if (zenMode) {
      setZenMode(false, true, newWindow);
    } else {
      newWindow.setFullScreen(false);
    }
  });
  newWindow.webContents.on('did-finish-load', () => {
    if (!isWindowUsable(newWindow) || isQuitting) return;
    watchNotesDirectory(newWindow);
    syncActiveWindowAppearanceMenu(newWindow);
    syncActiveWindowSidebarMenu(newWindow);
    syncActiveWindowPreviewMenu(newWindow);
    syncActiveWindowEditorHistoryMenu(newWindow);
    sendToWindow(newWindow, 'full-screen-changed', newWindow.isFullScreen());
    if (session.maximized) newWindow.maximize();
    scheduleWindowSessionSave();
  });
  newWindow.on('page-title-updated', event => {
    event.preventDefault();
    newWindow.setTitle(appName);
  });
  newWindow.on('focus', () => {
    if (!isWindowUsable(newWindow) || isQuitting) return;
    rebuildApplicationMenu();
    syncActiveWindowAppearanceMenu(newWindow);
    syncActiveWindowSidebarMenu(newWindow);
    syncActiveWindowPreviewMenu(newWindow);
    syncActiveWindowEditorHistoryMenu(newWindow);
  });
  newWindow.on('resize', scheduleWindowSessionSave);
  newWindow.on('move', scheduleWindowSessionSave);
  newWindow.on('enter-full-screen', () => {
    sendToWindow(newWindow, 'full-screen-changed', true);
  });
  newWindow.on('leave-full-screen', () => {
    if (isQuitting) return;
    sendToWindow(newWindow, 'full-screen-changed', false);
    if (zenMode) setZenMode(false, false, newWindow);
    if (readingWindowStates.has(newWindow)) setReadingMode(false, newWindow);
  });
  newWindow.on('closed', () => {
    const workspace = windowWorkspaces.get(newWindow);
    closeWorkspaceWatcher(workspace);
    windowWorkspaces.delete(newWindow);
    if (mainWindow === newWindow) {
      mainWindow = BrowserWindow.getAllWindows().find(window => !window.isDestroyed()) || null;
    }
    if (!isQuitting) {
      rebuildApplicationMenu();
      scheduleWindowSessionSave();
    }
  });

  rebuildApplicationMenu();
  syncActiveWindowAppearanceMenu(newWindow);
}

function getWindowMenuItems() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return BrowserWindow.getAllWindows()
    .filter(window => !window.isDestroyed() && windowWorkspaces.has(window))
    .map((window, index) => {
      const workspace = getWindowWorkspace(window);
      const config = getConfig();
      const location = config.notesLocations.find(item => item.path === workspace.notesDir);
      const workspaceName = location?.alias || path.basename(workspace.notesDir);
      return {
        label: `${index + 1}. ${workspaceName}`,
        type: 'checkbox',
        checked: window === focusedWindow,
        accelerator: index < 9 ? `CmdOrCtrl+${index + 1}` : undefined,
        click: () => {
          if (window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
      };
    });
}

function rebuildApplicationMenu() {

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
          click: () => createWindow({ showWelcome: true })
        },
        { type: 'separator' },
        {
          label: '快速打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToActiveWindow('quick-open')
        },
        {
          label: '查看历史版本…',
          click: () => sendToActiveWindow('open-note-history')
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
        { type: 'separator' },
        {
          label: '导出 PDF…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendToActiveWindow('export-pdf')
        },
        {
          label: '导出 HTML…',
          click: () => sendToActiveWindow('export-html')
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
        {
          id: 'editor-undo',
          label: '撤销',
          accelerator: 'CmdOrCtrl+Z',
          enabled: false,
          click: () => sendToActiveWindow('editor-undo')
        },
        {
          id: 'editor-redo',
          label: '重做',
          accelerator: 'CmdOrCtrl+Shift+Z',
          enabled: false,
          click: () => sendToActiveWindow('editor-redo')
        },
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
              id: 'appearance-system',
              type: 'checkbox',
              label: '跟随系统',
              click: () => setActiveWindowTheme('system')
            },
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
          label: '专注模式',
          submenu: [
            {
              id: 'reading-mode',
              type: 'checkbox',
              label: '阅读',
              click: (menuItem, browserWindow) => {
                setReadingMode(menuItem.checked, browserWindow);
              }
            },
            {
              id: 'zen-mode',
              type: 'checkbox',
              label: '写作',
              accelerator: 'CmdOrCtrl+Alt+Z',
              click: (menuItem, browserWindow) => {
                setZenMode(menuItem.checked, true, browserWindow);
              }
            }
          ]
        },
        { type: 'separator' },
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏幕' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        ...getWindowMenuItems()
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '更新说明',
          click: () => sendToActiveWindow('open-release-notes', app.getVersion())
        },
        {
          label: '更新页面',
          click: () => shell.openExternal('https://github.com/music586/simple-note/releases')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  const activeWindow = getActiveWindow();
  updateEditorHistoryMenu(activeWindow && windowEditorHistoryStates.get(activeWindow));
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

  nativeTheme.on('updated', broadcastSystemColorTheme);

  const windowSessions = getPersistedWindowSessions();
  if (windowSessions.length) {
    windowSessions.forEach(session => createWindow(session));
  } else {
    createWindow();
  }
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
  isQuitting = true;
  if (windowSessionSaveTimer) clearTimeout(windowSessionSaveTimer);
  windowSessionSaveTimer = null;
  persistWindowSessions();
  clearInterval(topbarHoverTimer);
  topbarHoverTimer = null;
  windowWorkspaces.forEach(closeWorkspaceWatcher);
});

ipcMain.handle('get-notes-dir', async event => {
  return getNotesDir(event);
});

ipcMain.handle('close-current-window', async event => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) return false;
  sourceWindow.close();
  return true;
});

ipcMain.on('theme-changed', (event, theme) => {
  if (!['system', 'light', 'dark'].includes(theme)) return;
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

ipcMain.on('editor-history-state-changed', (event, state) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed() || !state || typeof state !== 'object') return;
  const normalizedState = {
    canUndo: Boolean(state.canUndo),
    canRedo: Boolean(state.canRedo),
    undoLabel: typeof state.undoLabel === 'string'
      ? state.undoLabel.replace(/\s+/g, ' ').slice(0, 30)
      : '',
    redoLabel: typeof state.redoLabel === 'string'
      ? state.redoLabel.replace(/\s+/g, ' ').slice(0, 30)
      : ''
  };
  windowEditorHistoryStates.set(sourceWindow, normalizedState);
  if (getActiveWindow() === sourceWindow) updateEditorHistoryMenu(normalizedState);
});

ipcMain.on('preview-visibility-changed', (event, visible) => {
  if (typeof visible !== 'boolean') return;
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (sourceWindow) windowPreviewStates.set(sourceWindow, visible);
  if (sourceWindow && getActiveWindow() === sourceWindow) updatePreviewMenu(visible);
});

ipcMain.handle('get-image-directory', async event => {
  try {
    return { success: true, ...getCurrentImageDirectoryState(event) };
  } catch (err) {
    try {
      const state = getRawCurrentImageDirectoryState(event);
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
    const notesDir = path.resolve(getNotesDir(event));
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
    const state = getRawCurrentImageDirectoryState(event);
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
      return { success: true, canceled: true, ...getRawCurrentImageDirectoryState(event) };
    }

    const selectedPath = path.resolve(result.filePaths[0]);
    validateCustomImageDirectory(selectedPath);
    const config = getConfig();
    config.imageDirectory = selectedPath;
    saveConfig(config);
    return { success: true, canceled: false, ...getCurrentImageDirectoryState(event) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('reset-image-directory', async event => {
  try {
    const config = getConfig();
    delete config.imageDirectory;
    saveConfig(config);
    return { success: true, ...getCurrentImageDirectoryState(event) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-ai-settings', async () => {
  try {
    const config = getConfig();
    const provider = aiProviders[config.aiProvider] ? config.aiProvider : 'deepseek';
    const apiKeys = {
      deepseek: typeof config.deepseekApiKey === 'string' ? config.deepseekApiKey : '',
      mimo: typeof config.mimoApiKey === 'string' ? config.mimoApiKey : '',
      hunyuan: typeof config.hunyuanApiKey === 'string' ? config.hunyuanApiKey : ''
    };
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
      provider,
      apiKey: apiKeys.deepseek,
      apiKeys,
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
    const { provider, apiKey, layoutPrompt } = settings;
    if (!aiProviders[provider]) throw new Error('AI 服务平台无效');
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
    const keyName = `${provider}ApiKey`;
    if (normalizedApiKey) config[keyName] = normalizedApiKey;
    else delete config[keyName];
    config.aiProvider = provider;
    config.deepseekLayoutPrompt = normalizedLayoutPrompt;
    saveConfig(config);
    return {
      success: true,
      provider,
      configured: Boolean(normalizedApiKey),
      layoutPrompt: normalizedLayoutPrompt
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('test-ai-api-key', async (event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') throw new Error('测试参数无效');
    const { provider, apiKey } = settings;
    if (!aiProviders[provider]) throw new Error('AI 服务平台无效');
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('API Key 不能为空');
    const normalizedApiKey = apiKey.trim();
    if (normalizedApiKey.length > 512 || /[\r\n\0]/.test(normalizedApiKey)) {
      throw new Error('API Key 格式无效');
    }
    await testAiApiKey(provider, normalizedApiKey);
    return { success: true, provider, providerName: aiProviders[provider].name };
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
    const provider = aiProviders[config.aiProvider] ? config.aiProvider : 'deepseek';
    const apiKey = config[`${provider}ApiKey`];
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error(`请先在设置中配置 ${aiProviders[provider].name} API Key`);
    }
    const layoutPrompt = typeof config.deepseekLayoutPrompt === 'string'
      && config.deepseekLayoutPrompt.trim()
      ? config.deepseekLayoutPrompt
      : defaultDeepseekLayoutPrompt;
    const optimizedContent = await requestAiLayout(
      provider,
      apiKey,
      layoutPrompt,
      content
    );
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
    const provider = aiProviders[config.aiProvider] ? config.aiProvider : 'deepseek';
    const apiKey = config[`${provider}ApiKey`];
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error(`请先在设置中配置 ${aiProviders[provider].name} API Key`);
    }
    const targetName = targetLanguage === 'zh' ? '中文' : '英文';
    const prompt = `${deepseekTranslationPrompt}\n\n目标语言：${targetName}`;
    const translatedContent = await requestAiLayout(
      provider,
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

ipcMain.handle('export-current-html', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) {
    return { success: false, error: '找不到要导出的窗口' };
  }
  if (!payload || typeof payload.html !== 'string' || payload.html.length === 0) {
    return { success: false, error: '导出的 HTML 内容无效' };
  }

  const safeName = typeof payload.suggestedName === 'string'
    ? payload.suggestedName.replace(/[\\/:*?"<>|]/g, '-').trim()
    : '';
  const result = await dialog.showSaveDialog(sourceWindow, {
    title: '导出 HTML',
    defaultPath: path.join(app.getPath('documents'), `${safeName || '未命名笔记'}.html`),
    filters: [{ name: 'HTML 文件', extensions: ['html'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };

  try {
    fs.writeFileSync(result.filePath, payload.html, 'utf-8');
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

ipcMain.handle('get-notes-info', async event => {
  const config = getConfig();
  const workspace = getWindowWorkspace(event);
  const notesDir = getNotesDir(event);
  const location = config.notesLocations.find(item => item.path === notesDir);
  return {
    path: notesDir,
    alias: location?.alias || '',
    name: path.basename(notesDir),
    workspaceId: workspace?.id || 0
  };
});

ipcMain.handle('set-notes-alias', async (event, alias) => {
  const config = getConfig();
  const notesDir = getNotesDir(event);
  const notesAlias = typeof alias === 'string' ? alias.trim().slice(0, 60) : '';
  const location = config.notesLocations.find(item => item.path === notesDir);
  if (location) location.alias = notesAlias;
  if (config.notesDir === notesDir) config.notesAlias = notesAlias;
  saveConfig(config);
  rebuildApplicationMenu();
  return notesAlias;
});

ipcMain.handle('set-location-alias', async (event, { locationPath, alias }) => {
  const config = getConfig();
  const location = config.notesLocations.find(item => item.path === locationPath);
  if (!location) return { success: false, error: '目录不存在' };
  location.alias = typeof alias === 'string' ? alias.trim().slice(0, 60) : '';
  if (config.notesDir === locationPath) config.notesAlias = location.alias;
  saveConfig(config);
  rebuildApplicationMenu();
  return { success: true };
});

ipcMain.handle('get-notes-locations', async event => {
  const config = getConfig();
  return {
    activePath: getNotesDir(event),
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
    defaultPath: getNotesDir(event)
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const config = getConfig();
    const selectedPath = path.resolve(result.filePaths[0]);
    config.notesDir = selectedPath;
    let location = config.notesLocations.find(item => item.path === selectedPath);
    if (!location) {
      location = { path: selectedPath, alias: '' };
      config.notesLocations.push(location);
    }
    config.notesAlias = location.alias || '';
    saveConfig(config);
    setWindowNotesDir(sourceWindow, selectedPath);
    watchNotesDirectory(sourceWindow);
    rebuildApplicationMenu();
    return selectedPath;
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
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  setWindowNotesDir(sourceWindow, location.path);
  watchNotesDirectory(sourceWindow);
  rebuildApplicationMenu();
  return { success: true };
});

ipcMain.handle('remove-notes-dir', async (event, locationPath) => {
  const config = getConfig();
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  const activePath = getNotesDir(sourceWindow);
  if (config.notesLocations.length <= 1) {
    return { success: false, error: '至少需要保留一个存储目录' };
  }
  config.notesLocations = config.notesLocations.filter(item => item.path !== locationPath);
  if (config.notesDir === locationPath) {
    const nextLocation = config.notesLocations[0];
    config.notesDir = nextLocation.path;
    config.notesAlias = nextLocation.alias || '';
  }
  let nextActivePath = activePath;
  if (activePath === locationPath) {
    nextActivePath = config.notesLocations[0].path;
    setWindowNotesDir(sourceWindow, nextActivePath);
    watchNotesDirectory(sourceWindow);
  }
  saveConfig(config);
  rebuildApplicationMenu();
  return { success: true, activePath: nextActivePath };
});

ipcMain.handle('get-tree', async event => {
  ensureNotesDir(event);
  const notesDir = getNotesDir(event);
  return getTree(
    notesDir,
    '',
    getHiddenDirectories(),
    getFolderOrder(getConfig(), notesDir)
  );
});

ipcMain.handle('read-note', async (event, notePath) => {
  const filePath = resolveNotesPath(event, notePath, {
    expectedType: 'file',
    markdownOnly: true
  });
  const content = fs.readFileSync(filePath, 'utf-8');
  getHistoryStore(event).record(filePath, content, {
    reason: 'baseline',
    force: true
  });
  return content;
});

ipcMain.handle('save-note', async (event, { notePath, content, historyReason }) => {
  ensureNotesDir(event);
  if (typeof content !== 'string') throw new Error('笔记内容无效');
  if (Buffer.byteLength(content, 'utf8') > 50 * 1024 * 1024) {
    throw new Error('单篇笔记不能超过 50MB');
  }
  const candidatePath = notePath
    || path.join(getNotesDir(event), `untitled-${Date.now()}.md`);
  const filePath = resolveNotesPath(event, candidatePath, {
    mustExist: false,
    markdownOnly: true
  });
  const historyStore = getHistoryStore(event);
  if (fs.existsSync(filePath)) {
    historyStore.record(filePath, fs.readFileSync(filePath, 'utf8'), {
      reason: 'baseline',
      force: true
    });
  }
  writeFileAtomically(filePath, content);
  const allowedHistoryReasons = new Set(['manual-save', 'partial-restore']);
  historyStore.record(filePath, content, {
    reason: allowedHistoryReasons.has(historyReason) ? historyReason : 'auto-save',
    force: allowedHistoryReasons.has(historyReason)
  });
  return filePath;
});

ipcMain.handle('get-note-history', async (event, notePath) => {
  try {
    const filePath = resolveNotesPath(event, notePath, {
      expectedType: 'file',
      markdownOnly: true
    });
    const currentContent = fs.readFileSync(filePath, 'utf8');
    const historyStore = getHistoryStore(event);
    historyStore.record(filePath, currentContent, { reason: 'baseline', force: true });
    return {
      success: true,
      currentHash: hashContent(currentContent),
      versions: historyStore.list(filePath, currentContent)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-note-history-version', async (event, data) => {
  try {
    const filePath = resolveNotesPath(event, data?.notePath, {
      expectedType: 'file',
      markdownOnly: true
    });
    const result = getHistoryStore(event).read(filePath, data?.versionId);
    return { success: true, content: result.content, version: result.version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-note-history-version', async (event, data) => {
  try {
    const filePath = resolveNotesPath(event, data?.notePath, {
      expectedType: 'file',
      markdownOnly: true
    });
    const version = getHistoryStore(event).updateVersion(filePath, data?.versionId, {
      label: data?.label,
      note: data?.note,
      pinned: data?.pinned
    });
    return { success: true, version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-history-storage', async event => {
  try {
    return { success: true, ...getHistoryStore(event).getStats() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-history-settings', async (event, settings) => {
  try {
    const store = getHistoryStore(event);
    return {
      success: true,
      settings: store.updateSettings(settings),
      stats: store.getStats()
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cleanup-note-history', async (event, data) => {
  try {
    let notePath = null;
    if (data?.notePath) {
      notePath = resolveNotesPath(event, data.notePath, {
        expectedType: 'file',
        markdownOnly: true
      });
    }
    return { success: true, ...getHistoryStore(event).cleanup(notePath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('restore-note-history-version', async (event, data) => {
  try {
    const filePath = resolveNotesPath(event, data?.notePath, {
      expectedType: 'file',
      markdownOnly: true
    });
    const currentContent = fs.readFileSync(filePath, 'utf8');
    if (typeof data?.expectedHash !== 'string' || hashContent(currentContent) !== data.expectedHash) {
      throw new Error('笔记内容已经变化，请重新打开历史版本后再恢复');
    }
    const historyStore = getHistoryStore(event);
    const historical = historyStore.read(filePath, data?.versionId);
    historyStore.record(filePath, currentContent, {
      reason: 'before-restore',
      force: true
    });
    writeFileAtomically(filePath, historical.content);
    historyStore.record(filePath, historical.content, {
      reason: 'restore',
      force: true
    });
    return {
      success: true,
      content: historical.content,
      currentHash: hashContent(historical.content)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('apply-note-history-selection', async (event, data) => {
  try {
    const filePath = resolveNotesPath(event, data?.notePath, {
      expectedType: 'file',
      markdownOnly: true
    });
    const currentContent = fs.readFileSync(filePath, 'utf8');
    if (typeof data?.expectedHash !== 'string' || hashContent(currentContent) !== data.expectedHash) {
      throw new Error('笔记内容已经变化，请重新打开历史版本后再操作');
    }
    const start = Number(data?.start);
    const end = Number(data?.end);
    const text = data?.text;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0
      || end < start || end > currentContent.length || typeof text !== 'string') {
      throw new Error('局部恢复范围无效');
    }
    if (Buffer.byteLength(text, 'utf8') > 10 * 1024 * 1024) {
      throw new Error('单次恢复的内容不能超过 10MB');
    }
    const nextContent = currentContent.slice(0, start) + text + currentContent.slice(end);
    const historyStore = getHistoryStore(event);
    historyStore.record(filePath, currentContent, { reason: 'before-restore', force: true });
    writeFileAtomically(filePath, nextContent);
    historyStore.record(filePath, nextContent, { reason: 'partial-restore', force: true });
    return { success: true, content: nextContent, currentHash: hashContent(nextContent) };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

    const notesDir = path.resolve(getNotesDir(event));
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
  try {
    ensureNotesDir(event);
    const basePath = folderPath
      ? resolveNotesPath(event, folderPath, { expectedType: 'directory' })
      : fs.realpathSync(getNotesDir(event));
    const requestedName = validateEntryName(
      typeof name === 'string' && name.trim() ? name : '未命名',
      '笔记名称'
    ).replace(/\.md$/i, '');
    const defaultName = validateEntryName(requestedName, '笔记名称');
    let availableName = defaultName;
    let suffix = 2;
    let filePath = path.join(basePath, `${availableName}.md`);

    while (fs.existsSync(filePath)) {
      availableName = `${defaultName} ${suffix}`;
      suffix += 1;
      filePath = path.join(basePath, `${availableName}.md`);
    }

    fs.writeFileSync(filePath, '', { encoding: 'utf-8', flag: 'wx' });
    return { success: true, note: { name: availableName, path: filePath } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('create-folder', async (event, { name, parentPath }) => {
  ensureNotesDir(event);
  const basePath = parentPath
    ? resolveNotesPath(event, parentPath, { expectedType: 'directory' })
    : fs.realpathSync(getNotesDir(event));
  const folderName = validateEntryName(name, '文件夹名称');
  const folderPath = resolveNotesPath(
    event,
    path.join(basePath, folderName),
    { mustExist: false }
  );
  fs.mkdirSync(folderPath, { recursive: true });
  return folderPath;
});

ipcMain.handle('delete-note', async (event, notePath) => {
  const filePath = resolveNotesPath(event, notePath, {
    expectedType: 'file',
    markdownOnly: true
  });
  getHistoryStore(event).archivePath(filePath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  migrateAiOptimizedNotePaths(filePath);
  return true;
});

ipcMain.handle('delete-folder', async (event, folderPath) => {
  const resolvedFolderPath = resolveNotesPath(
    event,
    folderPath,
    { expectedType: 'directory' }
  );
  getHistoryStore(event).archivePath(resolvedFolderPath);
  if (fs.existsSync(resolvedFolderPath)) {
    fs.rmSync(resolvedFolderPath, { recursive: true, force: true });
  }
  migrateAiOptimizedNotePaths(resolvedFolderPath);
  return true;
});

ipcMain.handle('rename-note', async (event, { oldPath, newName }) => {
  const filePath = resolveNotesPath(event, oldPath, {
    expectedType: 'file',
    markdownOnly: true
  });
  const requestedName = validateEntryName(newName, '笔记名称').replace(/\.md$/i, '');
  const safeName = validateEntryName(requestedName, '笔记名称');
  const newPath = resolveNotesPath(event, path.join(path.dirname(filePath), `${safeName}.md`), {
    mustExist: false,
    markdownOnly: true
  });
  if (newPath !== filePath && fs.existsSync(newPath)) throw new Error('目标笔记已存在');
  if (newPath !== filePath) fs.renameSync(filePath, newPath);
  getHistoryStore(event).migratePath(filePath, newPath);
  migrateAiOptimizedNotePaths(filePath, newPath);
  return { name: safeName, path: newPath, mtime: fs.statSync(newPath).mtime };
});

ipcMain.handle('rename-folder', async (event, { oldPath, newName }) => {
  const folderPath = resolveNotesPath(event, oldPath, { expectedType: 'directory' });
  const safeName = validateEntryName(newName, '文件夹名称');
  const newPath = resolveNotesPath(event, path.join(path.dirname(folderPath), safeName), {
    mustExist: false
  });
  if (newPath !== folderPath && fs.existsSync(newPath)) throw new Error('目标文件夹已存在');
  if (newPath !== folderPath) fs.renameSync(folderPath, newPath);
  getHistoryStore(event).migratePath(folderPath, newPath);
  migrateAiOptimizedNotePaths(folderPath, newPath);
  return { name: safeName, path: newPath };
});

ipcMain.handle('move-item', async (event, { sourcePath, targetPath, type }) => {
  if (!['file', 'folder'].includes(type)) {
    return { success: false, error: '移动项目类型无效' };
  }
  const resolvedSourcePath = resolveNotesPath(event, sourcePath, {
    expectedType: type === 'file' ? 'file' : 'directory',
    markdownOnly: type === 'file'
  });
  const resolvedTargetPath = targetPath === null
    ? fs.realpathSync(getNotesDir(event))
    : resolveNotesPath(event, targetPath, { expectedType: 'directory' });
  const itemName = path.basename(resolvedSourcePath);
  let newPath;
  
  newPath = resolveNotesPath(event, path.join(resolvedTargetPath, itemName), {
    mustExist: false,
    markdownOnly: type === 'file'
  });
  
  if (resolvedSourcePath === newPath) {
    return { success: true, newPath };
  }

  if (fs.existsSync(newPath)) {
    return { success: false, error: '目标位置已存在同名文件或文件夹' };
  }
  
  if (type === 'folder') {
    if (isPathInside(resolvedSourcePath, newPath)) {
      return { success: false, error: '不能将文件夹移动到其子文件夹中' };
    }
  }
  
  try {
    fs.renameSync(resolvedSourcePath, newPath);
    getHistoryStore(event).migratePath(resolvedSourcePath, newPath);
    migrateAiOptimizedNotePaths(resolvedSourcePath, newPath);
    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('reorder-folder', async (event, { sourcePath, targetPath, placement }) => {
  try {
    if (!['before', 'after'].includes(placement)) {
      return { success: false, error: '目录排序位置无效' };
    }
    const resolvedSourcePath = resolveNotesPath(event, sourcePath, {
      expectedType: 'directory'
    });
    const resolvedTargetPath = resolveNotesPath(event, targetPath, {
      expectedType: 'directory'
    });
    const parentPath = path.dirname(resolvedSourcePath);
    if (parentPath !== path.dirname(resolvedTargetPath)) {
      return { success: false, error: '只能调整同级目录的顺序' };
    }

    const notesDir = fs.realpathSync(getNotesDir(event));
    const parentRelativePath = path.relative(notesDir, parentPath);
    const hiddenDirectories = getHiddenDirectories();
    const folderEntries = fs.readdirSync(parentPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => {
        const relativePath = parentRelativePath
          ? path.join(parentRelativePath, entry.name)
          : entry.name;
        return !isHiddenDirectory(relativePath, hiddenDirectories);
      })
      .map(entry => ({
        name: entry.name,
        mtimeMs: fs.statSync(path.join(parentPath, entry.name)).mtimeMs
      }));
    const sourceName = path.basename(resolvedSourcePath);
    const targetName = path.basename(resolvedTargetPath);
    const availableNames = new Set(folderEntries.map(entry => entry.name));
    if (!availableNames.has(sourceName) || !availableNames.has(targetName)) {
      return { success: false, error: '找不到要排序的目录' };
    }

    const config = getConfig();
    const workspaceKey = path.resolve(getNotesDir(event));
    const existingOrder = getFolderOrder(config, workspaceKey)[parentRelativePath] || [];
    const existingOrderIndexes = new Map(
      existingOrder.map((name, index) => [name, index])
    );
    folderEntries.sort((a, b) => {
      const aIndex = existingOrderIndexes.get(a.name);
      const bIndex = existingOrderIndexes.get(b.name);
      if (aIndex === undefined && bIndex === undefined) {
        return b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, 'zh-CN');
      }
      if (aIndex === undefined) return 1;
      if (bIndex === undefined) return -1;
      return aIndex - bIndex;
    });
    const names = folderEntries.map(entry => entry.name);
    names.splice(names.indexOf(sourceName), 1);
    const insertionIndex = names.indexOf(targetName) + (placement === 'after' ? 1 : 0);
    names.splice(insertionIndex, 0, sourceName);

    if (!config.folderOrders || typeof config.folderOrders !== 'object') {
      config.folderOrders = {};
    }
    if (!config.folderOrders[workspaceKey]) config.folderOrders[workspaceKey] = {};
    config.folderOrders[workspaceKey][parentRelativePath] = names;
    saveConfig(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('show-context-menu', (event, data) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) return;
  const { type, path: itemPath } = data;
  const template = [];
  
  if (type === 'file') {
    template.push({
      label: '在访达中显示',
      click: () => showItemInFileManager(sourceWindow, itemPath)
    });
    template.push({ type: 'separator' });
    template.push({
      label: '重命名',
      click: () => event.sender.send('context-menu-rename', data)
    });
    template.push({
      label: '删除',
      click: () => event.sender.send('context-menu-delete', data)
    });
  } else if (type === 'folder') {
    template.push({
      label: '新建笔记',
      click: () => event.sender.send('context-menu-new-note', data)
    });
    template.push({
      label: '新建文件夹',
      click: () => event.sender.send('context-menu-new-folder', data)
    });
    template.push({ type: 'separator' });
    template.push({
      label: '在访达中显示',
      click: () => showItemInFileManager(sourceWindow, itemPath)
    });
    template.push({ type: 'separator' });
    template.push({
      label: '重命名',
      click: () => event.sender.send('context-menu-rename', data)
    });
    template.push({
      label: '删除',
      click: () => event.sender.send('context-menu-delete', data)
    });
  } else if (type === 'root') {
    template.push({
      label: '新建笔记',
      click: () => event.sender.send('context-menu-new-note', data)
    });
    template.push({
      label: '新建文件夹',
      click: () => event.sender.send('context-menu-new-folder', data)
    });
  }
  
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: sourceWindow });
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
          click: () => event.sender.send('ai-translate-selection', 'zh')
        },
        {
          label: '英文',
          click: () => event.sender.send('ai-translate-selection', 'en')
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
