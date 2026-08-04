const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('退出阶段只向仍然可用的窗口发送 IPC', () => {
  assert.match(
    main,
    /function isWindowUsable\(targetWindow\)[\s\S]*targetWindow\.webContents\.isDestroyed\(\)/
  );
  assert.match(
    main,
    /function sendToWindow\(targetWindow, channel, \.\.\.args\)[\s\S]*isQuitting/
  );
  assert.match(main, /sendToWindow\(targetWindow, 'notes-tree-changed'\)/);
});

test('窗口关闭和应用退出只释放一次工作区监听器', () => {
  assert.match(
    main,
    /function closeWorkspaceWatcher\(workspace\)[\s\S]*workspace\.watcher = null;[\s\S]*watcher\.close\(\)/
  );
  assert.match(main, /newWindow\.on\('closed',[\s\S]*closeWorkspaceWatcher\(workspace\)/);
  assert.match(main, /windowWorkspaces\.forEach\(closeWorkspaceWatcher\)/);
});

test('退出期间不再重建菜单或安排新的会话保存', () => {
  assert.match(
    main,
    /newWindow\.on\('closed',[\s\S]*if \(!isQuitting\) \{\s*rebuildApplicationMenu\(\);\s*scheduleWindowSessionSave\(\);/
  );
  assert.match(main, /newWindow\.on\('leave-full-screen', \(\) => \{\s*if \(isQuitting\) return;/);
});
