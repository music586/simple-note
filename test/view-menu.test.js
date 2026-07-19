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

test('view menu exposes explicit light and dark appearance choices', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  assert.match(main, /label: '外观',[\s\S]*label: '明亮',[\s\S]*label: '黑暗'/);
  assert.match(main, /setActiveWindowTheme\('light'\)/);
  assert.match(main, /setActiveWindowTheme\('dark'\)/);
  assert.match(main, /setImmediate\(\(\) => updateAppearanceMenu\(theme\)\)/);
  assert.equal((main.match(/type: 'checkbox',[\s\S]{0,80}label: '(?:明亮|黑暗)'/g) || []).length, 2);
  assert.doesNotMatch(main, /label: '切换主题'/);
  assert.match(renderer, /ipcRenderer\.on\('set-color-theme'/);
  assert.match(renderer, /localStorage\.setItem\('color-theme', theme\)/);
  assert.match(main, /ipcMain\.on\('theme-changed'/);
  assert.match(main, /windowColorThemes\.set\(sourceWindow, theme\)/);
  assert.match(main, /getActiveWindow\(\) === sourceWindow/);
  assert.match(main, /newWindow\.on\('focus'/);
  assert.match(main, /webContents\.send\('request-color-theme'\)/);
  assert.match(renderer, /ipcRenderer\.on\('request-color-theme'/);
  assert.match(renderer, /event\.key !== 'color-theme'/);
});
