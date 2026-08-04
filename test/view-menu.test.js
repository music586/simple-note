const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('view menu uses the current sidebar visibility action', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(main, /label: '折叠侧边栏'/);
  assert.match(main, /id: 'collapse-sidebar'/);
  assert.match(main, /id: 'expand-sidebar'/);
  assert.match(main, /function updateVisibilityMenuItems\(name, visible\)/);
  assert.match(main, /collapseItem\.visible = visible/);
  assert.match(main, /expandItem\.visible = !visible/);
  assert.doesNotMatch(main, /applicationMenuTemplate/);
  assert.doesNotMatch(main, /applicationMenuRefreshTimer/);
  assert.doesNotMatch(main, /id: 'toggle-sidebar'/);
  assert.match(main, /ipcMain\.on\('sidebar-visibility-changed'/);
  assert.match(main, /webContents\.send\('request-sidebar-visibility'\)/);
  assert.match(
    main,
    /webContents\.on\('did-finish-load',[\s\S]*syncActiveWindowSidebarMenu\(newWindow\)/
  );
  assert.match(main, /webContents\.send\('set-sidebar-visibility', nextVisible\)/);
  assert.match(renderer, /ipcRenderer\.on\('request-sidebar-visibility'/);
  assert.match(renderer, /ipcRenderer\.on\('set-sidebar-visibility'/);
  assert.match(renderer, /function reportSidebarVisibility\(\)/);
  assert.match(main, /id: 'collapse-preview',[\s\S]*label: '折叠预览'/);
  assert.match(main, /id: 'expand-preview',[\s\S]*label: '展开预览'/);
  assert.match(main, /ipcMain\.on\('preview-visibility-changed'/);
  assert.match(main, /webContents\.send\('set-preview-visibility', nextVisible\)/);
  assert.match(renderer, /ipcRenderer\.on\('request-preview-visibility'/);
  assert.match(renderer, /ipcRenderer\.on\('set-preview-visibility'/);
  assert.doesNotMatch(main, /label: '折叠\/展开侧边栏'/);
  assert.doesNotMatch(main, /label: '打开\/关闭预览'/);
});

test('view menu exposes system, light and dark appearance choices', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(
    main,
    /label: '外观',[\s\S]*label: '跟随系统',[\s\S]*label: '明亮',[\s\S]*label: '黑暗'/
  );
  assert.match(main, /setActiveWindowTheme\('system'\)/);
  assert.match(main, /setActiveWindowTheme\('light'\)/);
  assert.match(main, /setActiveWindowTheme\('dark'\)/);
  assert.match(main, /setImmediate\(\(\) => updateAppearanceMenu\(theme\)\)/);
  assert.equal(
    (main.match(/type: 'checkbox',[\s\S]{0,80}label: '(?:跟随系统|明亮|黑暗)'/g) || [])
      .length,
    3
  );
  assert.doesNotMatch(main, /label: '切换主题'/);
  assert.match(renderer, /ipcRenderer\.on\('set-color-theme'/);
  assert.match(renderer, /localStorage\.setItem\('color-theme', theme\)/);
  assert.match(renderer, /window\.matchMedia\('\(prefers-color-scheme: light\)'\)/);
  assert.match(renderer, /systemColorTheme\.addEventListener\('change'/);
  assert.match(renderer, /colorThemeMode !== 'system'/);
  assert.match(main, /nativeTheme\.on\('updated', broadcastSystemColorTheme\)/);
  assert.match(main, /webContents\.send\('system-color-theme-changed', theme\)/);
  assert.match(renderer, /ipcRenderer\.on\('system-color-theme-changed'/);
  assert.match(main, /ipcMain\.on\('theme-changed'/);
  assert.match(main, /windowColorThemes\.set\(sourceWindow, theme\)/);
  assert.match(main, /getActiveWindow\(\) === sourceWindow/);
  assert.match(main, /newWindow\.on\('focus'/);
  assert.match(main, /webContents\.send\('request-color-theme'\)/);
  assert.match(renderer, /ipcRenderer\.on\('request-color-theme'/);
  assert.match(renderer, /event\.key === 'color-theme'/);
});

test('view menu groups reading and writing under focus mode', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(
    main,
    /label: '视图',[\s\S]*label: '专注模式',[\s\S]*submenu: \[[\s\S]*id: 'reading-mode',[\s\S]*label: '阅读',[\s\S]*id: 'zen-mode',[\s\S]*label: '写作'/
  );
  assert.doesNotMatch(main, /label: '纯阅读模式'/);
  assert.doesNotMatch(main, /label: '禅模式'/);
  assert.doesNotMatch(main, /label: '页面全屏'/);
});

test('reading mode uses native fullscreen and restores the previous window state', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(
    main,
    /function setReadingMode[\s\S]*readingWindowStates\.set[\s\S]*wasMaximized:[\s\S]*bounds:[\s\S]*setFullScreen\(true\)/
  );
  assert.match(
    main,
    /function restoreReadingWindowState[\s\S]*previousState\.wasMaximized[\s\S]*targetWindow\.maximize\(\)[\s\S]*targetWindow\.setBounds\(previousState\.bounds\)/
  );
  assert.match(
    main,
    /newWindow\.on\('leave-full-screen',[\s\S]*readingWindowStates\.has\(newWindow\)[\s\S]*setReadingMode\(false, newWindow\)/
  );
});
